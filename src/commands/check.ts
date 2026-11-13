import chalk from 'chalk';
import { ModManager } from '../services/mod-manager.js';
import type { CliOptions } from '../types/cli';

/**
 * Format version range for display
 */
function formatVersionRange(versions: string[]): string {
  if (!versions || versions.length === 0) return '';

  const sorted = [...versions].sort();
  if (sorted.length <= 2) {
    return sorted.join(', ');
  } else {
    return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  }
}

/**
 * Check command - scans directory for installed mods and syncs with config
 */
export async function checkCommand(
  modManager: ModManager,
  installDir: string,
  _options: CliOptions
): Promise<void> {
  console.log(chalk.green`Checking`, chalk.yellow`${installDir}`, chalk.green`for installed mods\n`);

  try {
    // Scan directory for mods
    const scanResult = await modManager.scanDirectory(installDir);

    // Display found mods
    for (const found of scanResult.found) {
      const mod = modManager.findMod(found.modName);
      if (!mod) continue;

      if (found.isNew) {
        console.log(chalk.green`\tAdding`, chalk.white`${mod.name}`, chalk.green`as new mod`);
      } else {
        console.log(chalk.green`\tFound`, chalk.white`${mod.name}`, chalk.green`as installed mod`);
      }

      if (found.movedFrom) {
        console.log(
          chalk.yellow`\t  ⚠ repository moved from`,
          chalk.white`${found.movedFrom}`,
          chalk.yellow`to`,
          chalk.white`${mod.remote}`
        );
        console.log(
          chalk.gray`\t    run: rw-lazy-installer relink ${found.name} ${mod.name}`
        );
      }

      const sibling = modManager.findActiveSibling(mod);
      if (sibling) {
        console.log(
          chalk.yellow`\t  ⚠ matched deprecated entry; active successor`,
          chalk.bold.white`${sibling.name}`,
          chalk.yellow`available`
        );
        console.log(
          chalk.gray`\t    run: rw-lazy-installer relink ${found.name} ${sibling.name}`
        );
      }
    }

    // Display missing mods (in config but not on disk)
    for (const missing of scanResult.missing) {
      console.log(
        chalk.red`\tMissing:`,
        chalk.white`${missing.name}`,
        chalk.gray`(in config but not found on disk)`
      );
    }

    // Display unknown directories
    for (const unknown of scanResult.unknown) {
      console.log(
        chalk.yellow`\tUnknown:`,
        chalk.white`${unknown}`,
        chalk.gray`(not a recognized mod)`
      );
    }

    // Sync configuration with disk state
    await modManager.syncConfigWithDisk(installDir);

    console.log(chalk.green`\nConfiguration synced with disk state`);

    // List all installed mods
    const installed = modManager.getInstalledMods();
    if (installed.length > 0) {
      console.log(chalk.green`\nInstalled mods:\n`);

      for (const installation of installed) {
        const mod = modManager.findMod(installation.name);
        if (!mod) continue;

        const versions = formatVersionRange(installation.supportedVersions || []);
        const displayPath = installation.directory.replace(installDir, '[mods]');

        if (mod.deprecated) {
          console.log(
            chalk.strikethrough.green`\t${mod.label.padEnd(40)}`,
            chalk.strikethrough.bold.white`${installation.name.padEnd(30)}`,
            chalk.strikethrough.bold.yellow`${versions.padEnd(20)}`,
            chalk.strikethrough.yellow`${displayPath.padEnd(40)}`,
            mod.remark ? chalk.gray` - ${mod.remark}` : ''
          );
        } else {
          console.log(
            chalk.green`\t${mod.label.padEnd(40)}`,
            chalk.bold.white`${installation.name.padEnd(30)}`,
            chalk.bold.yellow`${versions.padEnd(20)}`,
            chalk.yellow`${displayPath.padEnd(40)}`,
            mod.remark ? chalk.gray` - ${mod.remark}` : ''
          );
        }
      }
    } else {
      console.log(chalk.red`\tNo mods found!`);
    }

    console.log(chalk.green`\nInstall or update the mods with the ${chalk.bold.white`install`} or ${chalk.bold.white`update`} command.\n`);

  } catch (error) {
    console.error(chalk.red`Error:`, (error as Error).message);
    throw error;
  }
}