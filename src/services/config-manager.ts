import Conf from 'conf';
import type { AppConfig, UserPreferences } from '../types/config';
import type { ModInstallation } from '../types/mod';
import { sameRemote } from '../utils/remote.js';

/**
 * Configuration field names - maintaining backward compatibility
 */
const CONFIG_FIELDS = {
  INSTALLATION_DIR: 'installation-dir',
  INSTALLED_MODS: 'installed-mods',
  PREFERENCES: 'preferences',
  VERSION: 'config-version',
  LAST_MASTERLIST_UPDATE: 'last-masterlist-update',
} as const;

/**
 * Service for managing application configuration
 * Wraps the conf package with type safety and provides migration support
 */
export class ConfigManager {
  private config: Conf;

  constructor(projectName: string = 'rimworld-lazy-installer') {
    this.config = new Conf({ projectName });
    this.migrateIfNeeded();
  }

  /**
   * Get the installation directory path
   */
  getInstallationDir(): string | undefined {
    return this.config.get(CONFIG_FIELDS.INSTALLATION_DIR) as string | undefined;
  }

  /**
   * Set the installation directory path
   */
  setInstallationDir(dir: string): void {
    this.config.set(CONFIG_FIELDS.INSTALLATION_DIR, dir);
  }

  /**
   * Get all installed mods
   */
  getInstalledMods(): ModInstallation[] {
    const mods = this.config.get(CONFIG_FIELDS.INSTALLED_MODS) as any[] | undefined;
    if (!mods) return [];

    // Convert old format to new format if needed (for backward compatibility)
    return mods.map(mod => this.normalizeModInstallation(mod));
  }

  /**
   * Set the list of installed mods
   */
  setInstalledMods(mods: ModInstallation[]): void {
    this.config.set(CONFIG_FIELDS.INSTALLED_MODS, mods);
  }

  /**
   * Add or update a single installed mod
   */
  addOrUpdateInstalledMod(mod: ModInstallation): void {
    const installed = this.getInstalledMods();
    const index = installed.findIndex(m =>
      (mod.modId !== undefined && m.modId === mod.modId) || sameRemote(m.remote, mod.remote)
    );

    if (index >= 0) {
      installed[index] = mod;
    } else {
      installed.push(mod);
    }

    this.setInstalledMods(installed);
  }

  /**
   * Remove an installed mod
   */
  removeInstalledMod(modId: string): void {
    const installed = this.getInstalledMods();
    const filtered = installed.filter(m => m.modId !== modId && m.name !== modId);
    this.setInstalledMods(filtered);
  }

  /**
   * Find an installed mod by its remote URL
   */
  findInstalledModByRemote(remote: string): ModInstallation | undefined {
    return this.getInstalledMods().find(m => sameRemote(m.remote, remote));
  }

  /**
   * Check if a mod is installed by its remote URL
   */
  isModInstalled(remote: string): boolean {
    return this.findInstalledModByRemote(remote) !== undefined;
  }

  /**
   * Get user preferences
   */
  getPreferences(): UserPreferences {
    const prefs = this.config.get(CONFIG_FIELDS.PREFERENCES) as UserPreferences | undefined;
    return {
      autoUpdate: prefs?.autoUpdate ?? false,
      colorOutput: prefs?.colorOutput ?? true,
      verbosity: prefs?.verbosity ?? 'normal',
      parallelOperations: prefs?.parallelOperations ?? 3,
    };
  }

  /**
   * Update user preferences
   */
  updatePreferences(preferences: Partial<UserPreferences>): void {
    const current = this.getPreferences();
    this.config.set(CONFIG_FIELDS.PREFERENCES, { ...current, ...preferences });
  }

  /**
   * Get the last masterlist update time
   */
  getLastMasterlistUpdate(): Date | undefined {
    const timestamp = this.config.get(CONFIG_FIELDS.LAST_MASTERLIST_UPDATE) as string | undefined;
    return timestamp ? new Date(timestamp) : undefined;
  }

  /**
   * Set the last masterlist update time
   */
  setLastMasterlistUpdate(date: Date = new Date()): void {
    this.config.set(CONFIG_FIELDS.LAST_MASTERLIST_UPDATE, date.toISOString());
  }

  /**
   * Clear all configuration
   */
  clear(): void {
    this.config.clear();
  }

  /**
   * Get the full configuration object (for debugging/export)
   */
  getAll(): AppConfig {
    return {
      version: this.config.get(CONFIG_FIELDS.VERSION) as number | undefined,
      installationDir: this.getInstallationDir() || '',
      installedMods: this.getInstalledMods(),
      preferences: this.getPreferences(),
      lastMasterlistUpdate: this.getLastMasterlistUpdate(),
    };
  }

  /**
   * Normalize mod installation data for backward compatibility
   */
  private normalizeModInstallation(mod: any): ModInstallation {
    // Handle old format that might not have all fields
    return {
      modId: mod.modId || mod.mod || mod.name,
      name: mod.name || mod.mod,
      directory: mod.directory || mod.dir,
      remote: mod.remote,
      installedVersion: mod.installedVersion,
      supportedVersions: mod.supportedVersions,
      installedAt: mod.installedAt ? new Date(mod.installedAt) : new Date(),
      lastUpdated: mod.lastUpdated ? new Date(mod.lastUpdated) : new Date(),
      lastChecked: mod.lastChecked ? new Date(mod.lastChecked) : undefined,
    };
  }

  /**
   * Migrate configuration if needed
   */
  private migrateIfNeeded(): void {
    const version = this.config.get(CONFIG_FIELDS.VERSION) as number | undefined;

    // If no version, this is either new or v1 config
    if (!version) {
      // Check if we have old config data
      const hasOldData = this.config.get(CONFIG_FIELDS.INSTALLED_MODS) !== undefined;

      if (hasOldData) {
        // Migrate from v1 to v2
        console.log('Migrating configuration from v1 to v2...');

        // Normalize all installed mods
        const oldMods = this.config.get(CONFIG_FIELDS.INSTALLED_MODS) as any[];
        if (oldMods) {
          const normalizedMods = oldMods.map(mod => this.normalizeModInstallation(mod));
          this.config.set(CONFIG_FIELDS.INSTALLED_MODS, normalizedMods);
        }
      }

      // Set current version
      this.config.set(CONFIG_FIELDS.VERSION, 2);
    }
  }
}