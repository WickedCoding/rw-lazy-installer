import chalk from 'chalk';
import { ConfigManager } from '../services/config-manager.js';
import { RepositoryManager } from '../services/repository-manager.js';
import type { CommandOptions } from '../types/command.js';
import type { Mod, ModInstallation } from '../types/mod.js';
import { sameRemote } from '../utils/remote.js';

interface UpdateCommandOptions extends CommandOptions {
  /** Show changelog for all mods */
  log?: boolean;
  /** Show changelog only for updated mods */
  relevant?: boolean;
  /** Mod registry; enables warnings for installs that drifted from the masterlist (branch or moved remote) */
  registry?: Mod[];
}

/**
 * Warnings for an install whose checkout no longer matches the registry: a different branch
 * than the masterlist pins, or a remote the mod has moved away from. Both are fixed by `relink`.
 */
async function registryDriftWarnings(
  installed: ModInstallation,
  registry: Mod[],
  repoManager: RepositoryManager
): Promise<string[]> {
  const movedEntry = registry.find(m => m.previousRemotes?.some(r => sameRemote(r, installed.remote)));
  const entry = movedEntry ?? registry.find(m => sameRemote(m.remote, installed.remote));
  if (!entry) return [];

  const warnings: string[] = [];
  if (movedEntry) {
    warnings.push(`repository moved to ${entry.remote}`);
  }
  if (entry.branch) {
    const currentBranch = await repoManager.getCurrentBranch(installed.directory);
    if (currentBranch && currentBranch !== entry.branch) {
      warnings.push(`on branch '${currentBranch}', masterlist pins '${entry.branch}'`);
    }
  }
  if (warnings.length > 0) {
    warnings.push(`run: rw-lazy-installer relink ${installed.name} ${entry.name}`);
  }
  return warnings;
}

/**
 * Update installed mods to their latest versions
 */
export async function updateCommand(
  modNames: string[],
  options: UpdateCommandOptions
): Promise<void> {
  const configManager = new ConfigManager(options.configKey || 'default');
  const repoManager = new RepositoryManager();

  // Get directory from options or config
  const directory = options.dir || configManager.getInstallationDir();
  if (!directory) {
    throw new Error('No installation directory specified. Use --dir option or run "check" command first to set the directory.');
  }

  // Get all installed mods
  const installedMods = configManager.getInstalledMods();
  if (installedMods.length === 0) {
    console.log(chalk.yellow('No mods are currently installed.'));
    return;
  }

  // Filter mods to update
  let modsToUpdate = installedMods;
  if (modNames.length > 0) {
    modsToUpdate = installedMods.filter(mod =>
      modNames.includes(mod.modId) || modNames.includes(mod.name)
    );

    // Log which mods are not installed
    const notInstalled = modNames.filter(name =>
      !installedMods.some(mod => mod.modId === name || mod.name === name)
    );
    notInstalled.forEach(name => {
      console.log(chalk.red(`${name} is not installed`));
    });

    if (modsToUpdate.length === 0) {
      throw new Error('None of the specified mods are installed.');
    }
  }

  console.log(chalk.cyan(`Updating ${modsToUpdate.length} mod(s)...\n`));

  let updatedCount = 0;
  let failedCount = 0;
  const updateResults: Array<{ mod: string; status: 'updated' | 'no-changes' | 'failed'; error?: string }> = [];
  const driftedMods: string[] = [];

  // Update each mod
  for (const mod of modsToUpdate) {
    try {
      console.log(chalk.blue(`Checking ${mod.name}...`));

      if (options.registry) {
        const warnings = await registryDriftWarnings(mod, options.registry, repoManager);
        if (warnings.length > 0) {
          driftedMods.push(mod.name);
          warnings.forEach(warning => console.log(chalk.yellow(`  ⚠ ${warning}`)));
        }
      }

      // Get current commit before update
      const beforeCommit = await repoManager.getCurrentCommit(mod.directory);
      const result = await repoManager.updateRepository(mod.directory);

      if (result.success) {
        // Get commit after update
        const afterCommit = await repoManager.getCurrentCommit(mod.directory);
        const hasChanges = beforeCommit !== afterCommit;

        if (hasChanges) {
          updatedCount++;
          updateResults.push({ mod: mod.name, status: 'updated' });
          console.log(
            chalk.green(`✓ Updated ${mod.name}`),
            chalk.yellow(`[${beforeCommit?.substring(0, 6)} -> ${afterCommit?.substring(0, 6)}]`)
          );

          // Show changelog if requested
          if (options.log || options.relevant) {
            const commits = await repoManager.getRecentCommits(mod.directory, 5);
            if (commits.length > 0) {
              commits.forEach(commit => {
                console.log(chalk.white(`\t[${commit.hash}] ${commit.message}`));
              });
            }
          }

          // Update the last updated timestamp
          mod.lastUpdated = new Date();
          mod.lastChecked = new Date();
          configManager.addOrUpdateInstalledMod(mod);
        } else {
          updateResults.push({ mod: mod.name, status: 'no-changes' });
          console.log(
            chalk.gray(`✓ ${mod.name} is already up to date`),
            chalk.yellow(`[${afterCommit?.substring(0, 6)}]`)
          );

          // Show changelog if --log is specified (not --relevant)
          if (options.log) {
            const commits = await repoManager.getRecentCommits(mod.directory, 5);
            if (commits.length > 0) {
              commits.forEach(commit => {
                console.log(chalk.white(`\t[${commit.hash}] ${commit.message}`));
              });
            }
          }

          // Just update last checked timestamp
          mod.lastChecked = new Date();
          configManager.addOrUpdateInstalledMod(mod);
        }
      } else {
        failedCount++;
        updateResults.push({
          mod: mod.name,
          status: 'failed',
          error: result.error
        });
        console.error(chalk.red(`✗ Failed to update ${mod.name}: ${result.error}`));
      }
    } catch (error) {
      failedCount++;
      updateResults.push({
        mod: mod.name,
        status: 'failed',
        error: (error as Error).message
      });
      console.error(chalk.red(`✗ Failed to update ${mod.name}: ${(error as Error).message}`));
    }
  }

  // Print summary
  console.log(chalk.cyan('\n=== Update Summary ==='));
  console.log(chalk.green(`✓ ${updatedCount} mod(s) updated`));
  console.log(chalk.gray(`= ${updateResults.filter(r => r.status === 'no-changes').length} mod(s) already up to date`));
  if (driftedMods.length > 0) {
    console.log(chalk.yellow(`⚠ ${driftedMods.length} mod(s) need a relink: ${driftedMods.join(', ')}`));
  }
  if (failedCount > 0) {
    console.log(chalk.red(`✗ ${failedCount} mod(s) failed to update`));

    // Show failed mods
    const failedMods = updateResults.filter(r => r.status === 'failed');
    if (failedMods.length > 0) {
      console.log(chalk.red('\nFailed mods:'));
      failedMods.forEach(result => {
        console.log(chalk.red(`  - ${result.mod}: ${result.error}`));
      });
    }
  }

  // Throw error if any updates failed
  if (failedCount > 0) {
    throw new Error(`Failed to update ${failedCount} mod(s)`);
  }
}