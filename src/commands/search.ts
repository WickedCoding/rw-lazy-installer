import chalk from 'chalk';
import { ConfigManager } from '../services/config-manager.js';
import type { CommandOptions } from '../types/command.js';
import type { Mod } from '../types/mod.js';
import { findRegistryMod } from '../utils/remote.js';

interface SearchCommandOptions extends CommandOptions {
  /** Show installed mods (default: true) */
  installed?: boolean;
  /** Show new/available mods (default: true) */
  new?: boolean;
}

/**
 * Search for mods by name/label
 */
export async function searchCommand(
  term: string,
  options: SearchCommandOptions,
  modsRegistry: Mod[]
): Promise<void> {
  const configManager = new ConfigManager(options.configKey || 'default');
  const installDir = options.dir || configManager.getInstallationDir() || '[mods]';

  // Default to showing both if neither is explicitly set
  const showInstalled = options.installed !== false;
  const showNew = options.new !== false;

  const searchLower = term.toLowerCase();
  const installedMods = configManager.getInstalledMods()
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filter installed mods by search term
  const matchingInstalled = installedMods.filter(installed => {
    const mod = findRegistryMod(modsRegistry, installed.remote);
    return installed.name.toLowerCase().includes(searchLower) ||
           installed.modId.toLowerCase().includes(searchLower) ||
           (mod && (
             mod.name.toLowerCase().includes(searchLower) ||
             mod.label.toLowerCase().includes(searchLower)
           ));
  });

  // Filter available mods by search term
  const matchingMods = modsRegistry.filter(mod =>
    mod.name.toLowerCase().includes(searchLower) ||
    mod.label.toLowerCase().includes(searchLower)
  );

  // Show installed mods matching search
  if (showInstalled) {
    console.log(chalk.green`You have installed:\n`);

    if (matchingInstalled.length > 0) {
      matchingInstalled.forEach(installed => {
        const mod = findRegistryMod(modsRegistry, installed.remote);

        if (!mod) {
          // Mod not in registry anymore (missing)
          console.log(
            chalk.strikethrough.red`\t${'missing'.padEnd(40)}`,
            chalk.strikethrough.bold.white`${installed.name.padEnd(30)}`,
            chalk.strikethrough.bold.yellow`${formatVersionRange(installed.supportedVersions || []).padEnd(20)}`,
            chalk.strikethrough.yellow`${installed.directory.replace(installDir, '[mods]').padEnd(40)}`
          );
        } else if (mod.deprecated) {
          // Deprecated mod
          console.log(
            chalk.strikethrough.green`\t${mod.label.padEnd(40)}`,
            chalk.strikethrough.bold.white`${installed.name.padEnd(30)}`,
            chalk.strikethrough.bold.yellow`${formatVersionRange(installed.supportedVersions || []).padEnd(20)}`,
            chalk.strikethrough.yellow`${installed.directory.replace(installDir, '[mods]').padEnd(40)}`,
            mod.remark ? chalk.gray` - ${mod.remark}` : ''
          );
        } else {
          // Normal installed mod
          console.log(
            chalk.green`\t${mod.label.padEnd(40)}`,
            chalk.bold.white`${installed.name.padEnd(30)}`,
            chalk.bold.yellow`${formatVersionRange(installed.supportedVersions || []).padEnd(20)}`,
            chalk.yellow`${installed.directory.replace(installDir, '[mods]').padEnd(40)}`,
            mod.remark ? chalk.gray` - ${mod.remark}` : ''
          );
        }
      });
    } else {
      console.log(chalk.red`\tNo mods found for "${term}"!`);
    }

    console.log(chalk.green`\nInstall or update the mods with the ${chalk.bold.white`install`} or ${chalk.bold.white`update`} command.\n`);
  }

  // Show available mods matching search
  if (showNew) {
    console.log(chalk.green`\nInstallable mods:\n`);

    const availableMatchingMods = matchingMods.filter(mod =>
      !installedMods.some(installed => findRegistryMod([mod], installed.remote))
    );

    if (availableMatchingMods.length > 0) {
      const longestName = Math.max(30, ...availableMatchingMods.map(m => m.name.length));
      const longestLabel = Math.max(40, ...availableMatchingMods.map(m => m.label.length));

      availableMatchingMods
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(mod => {
          if (mod.deprecated) {
            console.log(
              chalk.strikethrough.green`\t${mod.label.padEnd(longestLabel)}`,
              chalk.strikethrough.bold.white`${mod.name.padEnd(longestName)}`,
              chalk.strikethrough.yellow`${mod.remote.padEnd(70)}`,
              mod.remark ? chalk.gray` - ${mod.remark}` : ''
            );
          } else {
            console.log(
              chalk.green`\t${mod.label.padEnd(longestLabel)}`,
              chalk.bold.white`${mod.name.padEnd(longestName)}`,
              chalk.yellow`${mod.remote.padEnd(70)}`,
              mod.remark ? chalk.gray` - ${mod.remark}` : ''
            );
          }
        });
    } else {
      console.log(chalk.gray`\tNo available mods found for "${term}"!`);
    }
  }

  // Show summary
  const totalMatches = (showInstalled ? matchingInstalled.length : 0) +
                       (showNew ? matchingMods.filter(m => !installedMods.some(i => findRegistryMod([m], i.remote))).length : 0);

  if (totalMatches > 0) {
    console.log(chalk.green`\n\n\ti.e.`, chalk.bold.white`$ rw-lazy-installer install ${matchingMods[0]?.name || 'mod-name'}\n`);
  } else {
    console.log(chalk.yellow`\nNo mods found matching "${term}"\n`);
  }
}

/**
 * Format version range for display
 */
function formatVersionRange(versions: string[]): string {
  if (!versions || versions.length === 0) {
    return '';
  }

  const sorted = [...versions].sort();
  if (sorted.length <= 2) {
    return sorted.join(', ');
  } else {
    return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  }
}