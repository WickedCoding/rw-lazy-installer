import chalk from 'chalk';
import { ModManager } from '../services/mod-manager.js';
import type { CliOptions } from '../types/cli';

export interface RelinkOptions extends CliOptions {
  directory: string;
  target: string;
}

/**
 * Relink command - rebinds an installed directory to a different registry entry
 */
export async function relinkCommand(
  modManager: ModManager,
  installDir: string,
  options: RelinkOptions
): Promise<void> {
  const { directory, target, force } = options;

  const targetMod = modManager.findMod(target);
  if (targetMod?.deprecated) {
    console.log(chalk.yellow`Warning: '${target}' is deprecated.`);
  }

  try {
    console.log(chalk.yellow`Relinking ${directory} to ${target}...`);
    const installation = await modManager.relinkMod(directory, target, installDir, { force });

    console.log(
      chalk.green`Relinked`,
      chalk.white`${directory}`,
      chalk.green`→`,
      chalk.white`${installation.modId}`
    );
    console.log(chalk.gray`  remote: ${installation.remote}`);
    if (targetMod?.branch) {
      console.log(chalk.gray`  branch: ${targetMod.branch}`);
    }
    if (installation.supportedVersions && installation.supportedVersions.length > 0) {
      console.log(chalk.gray`  versions: ${installation.supportedVersions.join(', ')}`);
    }
  } catch (error) {
    console.error(chalk.red`Failed to relink ${directory}: ${(error as Error).message}`);
    throw error;
  }
}
