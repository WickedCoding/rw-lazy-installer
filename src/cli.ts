#!/usr/bin/env node

import { program } from 'commander';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { ConfigManager } from './services/config-manager.js';
import { RepositoryManager } from './services/repository-manager.js';
import { ModManager } from './services/mod-manager.js';
import { checkCommand, installCommand, updateCommand, uninstallCommand, listCommand, searchCommand, relinkCommand } from './commands/index.js';
import { showHeader } from './utils/display.js';
import type { Mod } from './types/mod';

// Load package.json for version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(
  await readFile(path.join(__dirname, '../package.json'), 'utf-8')
);
const version = packageJson.version;

// Load mods registry
const modsRegistry: Mod[] = JSON.parse(
  await readFile(path.join(__dirname, '../mods.json'), 'utf-8')
);

// Initialize services
const config = new ConfigManager('rimworld-lazy-installer');
const repository = new RepositoryManager();
const modManager = new ModManager(config, repository, modsRegistry);

// Helper to get installation directory
function getInstallationDir(options: any): string {
  return options.dir || config.getInstallationDir() || process.cwd();
}

// Setup CLI
program.version(version);
program.option('-d, --dir <dir>', 'RimWorld Mod Directory');

// Check command
program
  .command('check')
  .description('Reads and lists installed mods')
  .action(async () => {
    showHeader(version);
    const installDir = getInstallationDir(program.opts());
    await checkCommand(modManager, installDir, program.opts());
  });

// Install command
program
  .command('install <name...>')
  .description('Install mods that do not exist yet, this command will not update')
  .action(async (names: string[]) => {
    showHeader(version);
    const installDir = getInstallationDir(program.opts());
    await installCommand(modManager, installDir, { ...program.opts(), names });
  });

// Update command
program
  .command('update [names...]')
  .description('Updates mods, this command will not install new mods')
  .option('-l, --log', 'Show changelog')
  .option('-r, --relevant', 'Show changelog for updated mods')
  .action(async (names: string[] = [], options) => {
    showHeader(version);
    await updateCommand(names, {
      dir: program.opts().dir,
      configKey: 'rimworld-lazy-installer',
      log: options.log,
      relevant: options.relevant,
      registry: modsRegistry
    });
  });

// Uninstall command
program
  .command('uninstall <name...>')
  .description('Uninstalls mod if installed')
  .action(async (names: string[]) => {
    showHeader(version);
    await uninstallCommand(names, {
      dir: program.opts().dir,
      configKey: 'rimworld-lazy-installer'
    }, modsRegistry);
  });

// List command
program
  .command('list', { isDefault: true })
  .description('A little overview of what this does')
  .option('--no-installed', 'Do not show only installed mods')
  .option('--no-new', 'Do not show mods that can be installed')
  .option('-s, --supported <version>', 'Filter by supported RimWorld version (e.g., "1.6")')
  .action(async (options) => {
    showHeader(version);
    await listCommand({
      dir: program.opts().dir,
      configKey: 'rimworld-lazy-installer',
      installed: options.installed,
      new: options.new,
      supported: options.supported
    }, modsRegistry);
  });

// Relink command
program
  .command('relink <directory> <target>')
  .description('Rebind a directory to a different registry entry (rewrites git remote)')
  .option('-f, --force', 'Relink even if the working tree has uncommitted changes')
  .action(async (directory: string, target: string, options) => {
    showHeader(version);
    const installDir = getInstallationDir(program.opts());
    await relinkCommand(modManager, installDir, {
      ...program.opts(),
      directory,
      target,
      force: options.force
    });
  });

// Search command
program
  .command('search <term>')
  .description('Search within the list')
  .option('--no-installed', 'Do not show only installed mods')
  .option('--no-new', 'Do not show mods that can be installed')
  .action(async (term: string, options) => {
    showHeader(version);
    await searchCommand(term, {
      dir: program.opts().dir,
      configKey: 'rimworld-lazy-installer',
      installed: options.installed,
      new: options.new
    }, modsRegistry);
  });

// Parse arguments
program.parse();