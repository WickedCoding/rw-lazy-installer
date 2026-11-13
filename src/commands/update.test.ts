import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateCommand } from './update.js';
import { ConfigManager } from '../services/config-manager.js';
import { RepositoryManager } from '../services/repository-manager.js';
import type { ModInstallation } from '../types/mod.js';

// Mock ConfigManager
vi.mock('../services/config-manager.js');

// Mock RepositoryManager
vi.mock('../services/repository-manager.js');

describe('updateCommand', () => {
  let configManager: any;
  let repoManager: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock instances with methods
    configManager = {
      getInstallationDir: vi.fn(),
      getInstalledMods: vi.fn(() => []),
      addOrUpdateInstalledMod: vi.fn(),
    };

    repoManager = {
      updateRepository: vi.fn(),
      getCurrentCommit: vi.fn(),
      getRecentCommits: vi.fn(),
    };

    // Setup the mock implementations to return our instances
    vi.mocked(ConfigManager).mockImplementation(() => configManager);
    vi.mocked(RepositoryManager).mockImplementation(() => repoManager);

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registry drift warnings', () => {
    const installed: ModInstallation = {
      modId: 'mod1',
      name: 'mod1',
      directory: '/test/mods/mod1',
      remote: 'https://github.com/test/mod1.git',
      installedAt: new Date(),
      lastUpdated: new Date(),
    };

    beforeEach(() => {
      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue([installed]);
      repoManager.getCurrentCommit.mockResolvedValue('abc123');
      repoManager.updateRepository.mockResolvedValue({ success: true });
      repoManager.getCurrentBranch = vi.fn().mockResolvedValue('master');
    });

    const output = () => consoleLogSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');

    it('should warn when the checkout is on a different branch than the masterlist pins, and still update', async () => {
      const registry = [{ id: 'mod1', name: 'mod1', label: 'Mod 1', remote: 'https://github.com/test/mod1', branch: 'main' }];

      await updateCommand([], { configKey: 'test', registry });

      expect(output()).toContain("on branch 'master', masterlist pins 'main'");
      expect(output()).toContain('run: rw-lazy-installer relink mod1 mod1');
      expect(output()).toContain('1 mod(s) need a relink: mod1');
      expect(repoManager.updateRepository).toHaveBeenCalledWith('/test/mods/mod1');
    });

    it('should warn when the install points at a remote the mod moved away from', async () => {
      const registry = [{
        id: 'mod1', name: 'mod1', label: 'Mod 1',
        remote: 'https://github.com/new-owner/mod1.git',
        previousRemotes: ['https://github.com/test/mod1.git'],
      }];

      await updateCommand([], { configKey: 'test', registry });

      expect(output()).toContain('repository moved to https://github.com/new-owner/mod1.git');
      expect(repoManager.getCurrentBranch).not.toHaveBeenCalled();
    });

    it('should stay quiet when the branch matches', async () => {
      repoManager.getCurrentBranch = vi.fn().mockResolvedValue('main');
      const registry = [{ id: 'mod1', name: 'mod1', label: 'Mod 1', remote: 'https://github.com/test/mod1.git', branch: 'main' }];

      await updateCommand([], { configKey: 'test', registry });

      expect(output()).not.toContain('⚠');
    });
  });

  describe('successful updates', () => {
    it('should update all installed mods when no names specified', async () => {
      const installedMods: ModInstallation[] = [
        {
          modId: 'mod1',
          name: 'mod1',
          directory: '/test/mods/mod1',
          remote: 'https://github.com/test/mod1.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
        {
          modId: 'mod2',
          name: 'mod2',
          directory: '/test/mods/mod2',
          remote: 'https://github.com/test/mod2.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
      ];

      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue(installedMods);

      repoManager.getCurrentCommit
        .mockResolvedValueOnce('abc123')
        .mockResolvedValueOnce('def456');

      repoManager.updateRepository.mockResolvedValue({ success: true });

      await updateCommand([], { configKey: 'test' });

      expect(repoManager.updateRepository).toHaveBeenCalledTimes(2);
      expect(repoManager.updateRepository).toHaveBeenCalledWith('/test/mods/mod1');
      expect(repoManager.updateRepository).toHaveBeenCalledWith('/test/mods/mod2');
      expect(configManager.addOrUpdateInstalledMod).toHaveBeenCalledTimes(2);
    });

    it('should show changelog when --log option is used', async () => {
      const installedMods: ModInstallation[] = [
        {
          modId: 'mod1',
          name: 'mod1',
          directory: '/test/mods/mod1',
          remote: 'https://github.com/test/mod1.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
      ];

      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue(installedMods);

      repoManager.getCurrentCommit.mockResolvedValue('abc123');
      repoManager.updateRepository.mockResolvedValue({ success: true });
      repoManager.getRecentCommits.mockResolvedValue([
        {
          hash: 'abc123',
          date: '2024-01-01',
          message: 'Update feature X',
          author_name: 'Test Author',
        },
      ]);

      await updateCommand([], { configKey: 'test', log: true });

      expect(repoManager.getRecentCommits).toHaveBeenCalledWith('/test/mods/mod1', 5);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('abc123'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Update feature X'));
    });

    it('should only show changelog for updated mods when --relevant is used', async () => {
      const installedMods: ModInstallation[] = [
        {
          modId: 'mod1',
          name: 'mod1',
          directory: '/test/mods/mod1',
          remote: 'https://github.com/test/mod1.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
      ];

      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue(installedMods);

      const oldCommit = 'abc123';
      const newCommit = 'def456';

      repoManager.getCurrentCommit
        .mockResolvedValueOnce(oldCommit) // Before update
        .mockResolvedValueOnce(newCommit); // After update

      repoManager.updateRepository.mockResolvedValue({ success: true });
      repoManager.getRecentCommits.mockResolvedValue([
        {
          hash: newCommit,
          date: '2024-01-02',
          message: 'New feature',
          author_name: 'Test Author',
        },
        {
          hash: oldCommit,
          date: '2024-01-01',
          message: 'Old feature',
          author_name: 'Test Author',
        },
      ]);

      await updateCommand([], { configKey: 'test', log: true, relevant: true });

      expect(repoManager.getRecentCommits).toHaveBeenCalledWith('/test/mods/mod1', 5);
      // Should only show the new commit
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(newCommit));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('New feature'));
    });

    it('should update only specified mods', async () => {
      const installedMods: ModInstallation[] = [
        {
          modId: 'mod1',
          name: 'mod1',
          directory: '/test/mods/mod1',
          remote: 'https://github.com/test/mod1.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
        {
          modId: 'mod2',
          name: 'mod2',
          directory: '/test/mods/mod2',
          remote: 'https://github.com/test/mod2.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
      ];

      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue(installedMods);

      repoManager.getCurrentCommit
        .mockResolvedValueOnce('abc123')
        .mockResolvedValueOnce('def456');

      repoManager.updateRepository.mockResolvedValue({ success: true });

      await updateCommand(['mod1'], { configKey: 'test' });

      // Should only update mod1
      expect(repoManager.updateRepository).toHaveBeenCalledTimes(1);
      expect(repoManager.updateRepository).toHaveBeenCalledWith('/test/mods/mod1');
    });
  });

  describe('error handling', () => {
    it('should handle no installation directory', async () => {
      configManager.getInstallationDir.mockReturnValue(undefined);

      await expect(updateCommand([], { configKey: 'test' })).rejects.toThrow(
        'No installation directory specified'
      );
    });

    it('should handle no installed mods gracefully', async () => {
      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue([]);

      await updateCommand([], { configKey: 'test' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No mods are currently installed')
      );
      expect(repoManager.updateRepository).not.toHaveBeenCalled();
    });

    it('should handle update failures', async () => {
      const installedMods: ModInstallation[] = [
        {
          modId: 'mod1',
          name: 'mod1',
          directory: '/test/mods/mod1',
          remote: 'https://github.com/test/mod1.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
        {
          modId: 'mod2',
          name: 'mod2',
          directory: '/test/mods/mod2',
          remote: 'https://github.com/test/mod2.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
      ];

      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue(installedMods);

      repoManager.getCurrentCommit
        .mockResolvedValueOnce('abc123')
        .mockResolvedValueOnce('def456');

      repoManager.updateRepository
        .mockResolvedValueOnce({ success: true }) // mod1 succeeds
        .mockResolvedValueOnce({ success: false, error: 'Network error' }); // mod2 fails

      await expect(updateCommand([], { configKey: 'test' })).rejects.toThrow(
        'Failed to update 1 mod(s)'
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Updated mod1'), expect.any(String));
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Failed to update mod2: Network error')
      );
    });

    it('should handle non-existent specified mods', async () => {
      const installedMods: ModInstallation[] = [
        {
          modId: 'mod1',
          name: 'mod1',
          directory: '/test/mods/mod1',
          remote: 'https://github.com/test/mod1.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
      ];

      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue(installedMods);

      await expect(updateCommand(['mod2', 'mod3'], { configKey: 'test' })).rejects.toThrow(
        'None of the specified mods are installed'
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('mod2 is not installed')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('mod3 is not installed')
      );
    });
  });

  describe('summary output', () => {
    it('should show correct summary with mixed results', async () => {
      const installedMods: ModInstallation[] = [
        {
          modId: 'mod1',
          name: 'mod1',
          directory: '/test/mods/mod1',
          remote: 'https://github.com/test/mod1.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
        {
          modId: 'mod2',
          name: 'mod2',
          directory: '/test/mods/mod2',
          remote: 'https://github.com/test/mod2.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
        {
          modId: 'mod3',
          name: 'mod3',
          directory: '/test/mods/mod3',
          remote: 'https://github.com/test/mod3.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        },
      ];

      configManager.getInstallationDir.mockReturnValue('/test/mods');
      configManager.getInstalledMods.mockReturnValue(installedMods);

      repoManager.getCurrentCommit
        .mockResolvedValueOnce('commit1')
        .mockResolvedValueOnce('commit2')
        .mockResolvedValueOnce('commit3');

      repoManager.updateRepository
        .mockResolvedValueOnce({ success: true }) // mod1 succeeds
        .mockResolvedValueOnce({ success: false, error: 'Permission denied' }) // mod2 fails
        .mockResolvedValueOnce({ success: true }); // mod3 succeeds

      await expect(updateCommand([], { configKey: 'test' })).rejects.toThrow(
        'Failed to update 1 mod(s)'
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓ 1 mod(s) updated'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✗ 1 mod(s) failed to update'));
    });
  });
});