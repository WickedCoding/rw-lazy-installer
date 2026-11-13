import { XMLParser } from 'fast-xml-parser';
import path from 'path';
import fs from 'fs/promises';
import { ConfigManager } from './config-manager.js';
import { RepositoryManager } from './repository-manager.js';
import type {
  Mod,
  ModInstallation,
  UpdateResult,
  ModFilter,
  InstallationReport
} from '../types/mod';
import { sameRemote } from '../utils/remote.js';

/**
 * Result from scanning a directory for mods
 */
export interface ScanResult {
  /** Mods found in directory */
  found: Array<{
    name: string;        // Actual directory name on disk
    modName: string;     // Registry mod name for display
    remote: string;
    versions: string[];
    isNew: boolean;  // Not in config yet
    movedFrom?: string;  // Old remote the directory still points at, when the mod moved repositories
  }>;

  /** Mods in config but missing from disk */
  missing: ModInstallation[];

  /** Directories on disk that aren't recognized mods */
  unknown: string[];
}

/**
 * Service for managing mod operations
 * Orchestrates between repository operations and configuration
 */
export class ModManager {
  private xmlParser: XMLParser;

  constructor(
    private config: ConfigManager,
    private repository: RepositoryManager,
    private modsRegistry: Mod[]
  ) {
    this.xmlParser = new XMLParser();
  }

  /**
   * Install a mod by name
   */
  async installMod(modName: string, installDir: string): Promise<ModInstallation> {
    // Find mod in registry
    const mod = this.findMod(modName);
    if (!mod) {
      throw new Error(`Mod '${modName}' is not a known mod and cannot be installed`);
    }

    // Check if already installed
    if (this.isModInstalled(mod.remote)) {
      throw new Error(`Mod '${modName}' is already installed`);
    }

    // Clone repository
    const modPath = path.join(installDir, modName);
    await this.repository.cloneRepository(mod.remote, modPath, mod.branch);

    // Extract version info
    let supportedVersions: string[] = [];
    try {
      supportedVersions = await this.extractModVersions(modPath);
    } catch (error) {
      // Version extraction is optional - don't fail installation
    }

    // Create installation record
    const installation: ModInstallation = {
      modId: mod.id,
      name: modName,
      directory: modPath,
      remote: mod.remote,
      supportedVersions,
      installedAt: new Date(),
      lastUpdated: new Date(),
    };

    // Save to config
    this.config.addOrUpdateInstalledMod(installation);

    return installation;
  }

  /**
   * Update a single mod
   */
  async updateMod(mod: ModInstallation): Promise<UpdateResult> {
    const startTime = Date.now();

    try {
      // Get current commit before update
      const beforeCommit = await this.repository.getCurrentCommit(mod.directory);

      // Perform update
      const pullResult = await this.repository.updateRepository(mod.directory);

      // Get commit after update
      const afterCommit = await this.repository.getCurrentCommit(mod.directory);

      // Update last checked time
      mod.lastChecked = new Date();
      if (pullResult.hasChanges) {
        mod.lastUpdated = new Date();
        mod.installedVersion = afterCommit;
      }
      this.config.addOrUpdateInstalledMod(mod);

      return {
        modId: mod.modId,
        success: pullResult.success,
        hasChanges: pullResult.hasChanges,
        previousVersion: beforeCommit,
        newVersion: afterCommit,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        modId: mod.modId,
        success: false,
        hasChanges: false,
        error: error as Error,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Update all installed mods
   */
  async updateAllMods(): Promise<UpdateResult[]> {
    const installed = this.config.getInstalledMods()
      .sort((a, b) => a.name.localeCompare(b.name));

    // Run all updates in parallel - Git will handle its own concurrency
    return Promise.all(installed.map(mod => this.updateMod(mod)));
  }

  /**
   * Relink a directory on disk to a different registry entry.
   * Rewrites the git remote, refreshes versions, and replaces the installation record.
   */
  async relinkMod(
    directoryName: string,
    targetModName: string,
    installDir: string,
    options: { force?: boolean } = {}
  ): Promise<ModInstallation> {
    const target = this.findMod(targetModName);
    if (!target) {
      throw new Error(`Mod '${targetModName}' is not a known mod`);
    }

    const directoryPath = path.join(installDir, directoryName);

    const status = await this.repository.getRepositoryStatus(directoryPath);
    if (!status.isValidRepo) {
      throw new Error(`Directory '${directoryName}' is not a valid git repository`);
    }

    const existingTargetInstall = this.config.findInstalledModByRemote(target.remote);
    if (existingTargetInstall && existingTargetInstall.directory !== directoryPath) {
      throw new Error(
        `Mod '${targetModName}' is already installed at ${existingTargetInstall.directory}`
      );
    }

    if (!options.force) {
      const dirty = await this.repository.hasUncommittedChanges(directoryPath);
      if (dirty) {
        throw new Error(
          `Directory '${directoryName}' has uncommitted changes. Re-run with --force to relink anyway.`
        );
      }
    }

    const previousInstall = this.config.getInstalledMods()
      .find(m => m.directory === directoryPath);

    await this.repository.setRemoteUrl(directoryPath, target.remote);

    // The masterlist pins a branch: move the checkout onto it so updates follow the right line
    if (target.branch) {
      const currentBranch = await this.repository.getCurrentBranch(directoryPath);
      if (currentBranch !== target.branch) {
        await this.repository.checkoutBranch(directoryPath, target.branch);
      }
    }

    let supportedVersions: string[] = [];
    try {
      supportedVersions = await this.extractModVersions(directoryPath);
    } catch (error) {
      // Version extraction is optional
    }

    if (previousInstall) {
      this.config.removeInstalledMod(previousInstall.modId);
    }

    const installation: ModInstallation = {
      modId: target.id,
      name: directoryName,
      directory: directoryPath,
      remote: target.remote,
      supportedVersions,
      installedAt: previousInstall?.installedAt ?? new Date(),
      lastUpdated: new Date(),
    };

    this.config.addOrUpdateInstalledMod(installation);
    return installation;
  }

  /**
   * Find the active sibling of a deprecated registry entry.
   * Matches deprecated mods to a non-deprecated entry whose name is the
   * deprecated name plus a `-1[3-9]` RimWorld-version suffix.
   */
  findActiveSibling(deprecatedMod: Mod): Mod | undefined {
    if (!deprecatedMod.deprecated) return undefined;

    return this.modsRegistry.find(candidate => {
      if (candidate.deprecated) return false;
      const match = candidate.name.match(/^(.+)-1[3-9]$/);
      return match?.[1] === deprecatedMod.name;
    });
  }

  /**
   * Uninstall a mod
   */
  async uninstallMod(modName: string): Promise<void> {
    // Find mod in registry
    const mod = this.findMod(modName);
    if (!mod) {
      throw new Error(`Mod '${modName}' is not a known mod and cannot be uninstalled`);
    }

    // Check if installed
    const installation = this.config.findInstalledModByRemote(mod.remote);
    if (!installation) {
      throw new Error(`Mod '${modName}' is not installed`);
    }

    // Remove directory
    try {
      // Remove .git directory first
      await fs.rm(path.join(installation.directory, '.git'), { recursive: true, force: true });
      // Then remove the mod directory
      await fs.rm(installation.directory, { recursive: true, force: true });
    } catch (error) {
      throw new Error(
        `Failed to remove mod directory: ${(error as Error).message}\n` +
        `Please manually remove:\n` +
        `  rm -rf ${installation.directory}/.git\n` +
        `  rm -rf ${installation.directory}`
      );
    }

    // Remove from config
    this.config.removeInstalledMod(modName);
  }

  /**
   * Scan a directory for installed mods and sync with config
   */
  async scanDirectory(installDir: string): Promise<ScanResult> {
    const result: ScanResult = {
      found: [],
      missing: [],
      unknown: [],
    };

    // Get current config state
    const configuredMods = this.config.getInstalledMods();

    // Read directory
    let files: string[];
    try {
      files = await fs.readdir(installDir);
    } catch (error) {
      throw new Error(`Cannot read installation directory: ${installDir}`);
    }

    // Filter out hidden files and non-directories
    const directories = files.filter(f =>
      !f.startsWith('.') &&
      f !== 'Icon\r' &&
      !f.includes('.txt')
    );

    // Check each directory
    const scanPromises = directories.map(async (dir) => {
      const fullPath = path.join(installDir, dir);

      // Check if it's a Git repository
      const status = await this.repository.getRepositoryStatus(fullPath);
      if (!status.isValidRepo || !status.remoteUrl) {
        result.unknown.push(dir);
        return;
      }

      // Check if it's a known mod, either at its current remote or at a remote it moved away from
      const remoteUrl = status.remoteUrl;
      let movedFrom: string | undefined;
      let mod = this.modsRegistry.find(m => sameRemote(m.remote, remoteUrl));
      if (!mod) {
        mod = this.modsRegistry.find(m => m.previousRemotes?.some(r => sameRemote(r, remoteUrl)));
        if (mod) movedFrom = remoteUrl;
      }

      if (!mod) {
        result.unknown.push(dir);
        return;
      }

      // Extract versions
      let versions: string[] = [];
      try {
        versions = await this.extractModVersions(fullPath);
      } catch (error) {
        // Version extraction is optional
      }

      // Check if it's already in config
      const isNew = !this.isModInstalled(mod.remote);

      result.found.push({
        name: dir,  // Use actual directory name from disk
        modName: mod.name,  // Registry mod name for display
        remote: mod.remote,
        versions,
        isNew,
        ...(movedFrom ? { movedFrom } : {}),
      });
    });

    await Promise.all(scanPromises);

    // Find mods that are in config but not on disk
    const foundRemotes = result.found.map(f => f.remote);
    result.missing = configuredMods.filter(m =>
      !foundRemotes.some(remote => sameRemote(remote, m.remote))
    );

    return result;
  }

  /**
   * Sync configuration with disk state after scanning
   */
  async syncConfigWithDisk(installDir: string): Promise<void> {
    const scanResult = await this.scanDirectory(installDir);

    // Build new installed mods list
    const updatedMods: ModInstallation[] = [];

    // Add all found mods
    for (const found of scanResult.found) {
      const mod = this.modsRegistry.find(m => sameRemote(m.remote, found.remote))!;
      const existing = this.config.findInstalledModByRemote(found.remote);

      if (existing) {
        // Update existing entry with correct directory
        existing.name = found.name;  // Update to actual directory name
        existing.directory = path.join(installDir, found.name);  // Update to actual path
        existing.supportedVersions = found.versions;
        updatedMods.push(existing);
      } else {
        // Create new entry
        updatedMods.push({
          modId: mod.id,
          name: found.name,
          directory: path.join(installDir, found.name),
          remote: found.remote,
          supportedVersions: found.versions,
          installedAt: new Date(),
          lastUpdated: new Date(),
        });
      }
    }

    // Update config with new state
    this.config.setInstallationDir(installDir);
    this.config.setInstalledMods(updatedMods);
  }

  /**
   * Find a mod by name or label
   */
  findMod(nameOrLabel: string): Mod | undefined {
    return this.modsRegistry.find(m =>
      m.name === nameOrLabel ||
      m.label === nameOrLabel
    );
  }

  /**
   * Search for mods by term
   */
  searchMods(term: string, filter?: ModFilter): Mod[] {
    const lowerTerm = term.toLowerCase();

    return this.modsRegistry.filter(mod => {
      // Apply search term
      const matchesTerm =
        mod.name.toLowerCase().includes(lowerTerm) ||
        mod.label.toLowerCase().includes(lowerTerm) ||
        (mod.remark && mod.remark.toLowerCase().includes(lowerTerm));

      if (!matchesTerm) return false;

      // Apply filters
      if (filter?.includeDeprecated === false && mod.deprecated) return false;
      if (filter?.installed === true && !this.isModInstalled(mod.remote)) return false;
      if (filter?.installed === false && this.isModInstalled(mod.remote)) return false;

      return true;
    });
  }

  /**
   * List mods with optional filter
   */
  listMods(filter?: ModFilter): Mod[] {
    return this.modsRegistry.filter(mod => {
      if (filter?.includeDeprecated === false && mod.deprecated) return false;
      if (filter?.installed === true && !this.isModInstalled(mod.remote)) return false;
      if (filter?.installed === false && this.isModInstalled(mod.remote)) return false;
      if (filter?.searchTerm && !this.searchMods(filter.searchTerm).includes(mod)) return false;

      return true;
    });
  }

  /**
   * Get all installed mods
   */
  getInstalledMods(): ModInstallation[] {
    return this.config.getInstalledMods().sort((a: ModInstallation, b: ModInstallation) => {
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Check if a mod is installed
   */
  isModInstalled(nameOrRemote: string): boolean {
    // Check by name
    const mod = this.findMod(nameOrRemote);
    if (mod) {
      return this.config.isModInstalled(mod.remote);
    }

    // Check by remote URL directly
    return this.config.isModInstalled(nameOrRemote);
  }

  /**
   * Extract supported versions from About.xml
   */
  async extractModVersions(modPath: string): Promise<string[]> {
    try {
      const aboutPath = path.join(modPath, 'About', 'About.xml');
      const xmlContent = await fs.readFile(aboutPath, 'utf-8');
      const parsed = this.xmlParser.parse(xmlContent);

      const versions = parsed.ModMetaData?.supportedVersions?.li;
      if (!versions) return [];

      return Array.isArray(versions) ? versions : [versions];
    } catch (error) {
      // If About.xml doesn't exist or can't be parsed, return empty array
      return [];
    }
  }

  /**
   * Get recent commits for a mod (for changelog display)
   */
  async getModChangelog(mod: ModInstallation, limit: number = 5): Promise<Array<{ hash: string; message: string }>> {
    return this.repository.getRecentCommits(mod.directory, limit);
  }

  /**
   * Generate an installation report
   */
  async generateInstallationReport(installDir: string): Promise<InstallationReport> {
    const scanResult = await this.scanDirectory(installDir);
    const configuredMods = this.config.getInstalledMods();

    return {
      totalMods: this.modsRegistry.length,
      installedMods: configuredMods.length,
      corruptedMods: [], // We don't detect corrupted mods currently
      missingMods: scanResult.missing.map(m => m.name),
      unknownMods: scanResult.unknown,
      recommendations: [
        ...scanResult.missing.length > 0 ?
          [`${scanResult.missing.length} mod(s) are in config but missing from disk`] : [],
        ...scanResult.unknown.length > 0 ?
          [`${scanResult.unknown.length} unknown folder(s) found in mods directory`] : [],
        ...scanResult.found.filter(f => f.isNew).length > 0 ?
          [`${scanResult.found.filter(f => f.isNew).length} new mod(s) found that can be added to config`] : [],
      ],
    };
  }
}