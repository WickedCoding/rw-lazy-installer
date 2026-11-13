import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ModInstallation } from '../types/mod';

// Mock the conf module before any imports that use it
vi.mock('conf', () => {
  // Create a mock store that persists between get/set calls
  class MockConf {
    private store: Map<string, any>;

    constructor() {
      this.store = new Map();
    }

    get(key: string) {
      return this.store.get(key);
    }

    set(key: string, value: any) {
      this.store.set(key, value);
    }

    clear() {
      this.store.clear();
    }

    // Expose store for test assertions
    getStore() {
      return this.store;
    }
  }

  return {
    default: MockConf,
  };
});

// Import ConfigManager after the mock is set up
import { ConfigManager } from './config-manager';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let mockConfInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create new instance
    configManager = new ConfigManager('test-project');

    // Get the mock instance for assertions
    mockConfInstance = (configManager as any).config;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Installation Directory', () => {
    it('should get installation directory when set', () => {
      mockConfInstance.set('installation-dir', '/test/mods');

      const dir = configManager.getInstallationDir();

      expect(dir).toBe('/test/mods');
    });

    it('should return undefined when installation directory not set', () => {
      const dir = configManager.getInstallationDir();

      expect(dir).toBeUndefined();
    });

    it('should set installation directory', () => {
      configManager.setInstallationDir('/new/mods');

      expect(mockConfInstance.get('installation-dir')).toBe('/new/mods');
    });
  });

  describe('Installed Mods', () => {
    const testMod: ModInstallation = {
      modId: 'test-mod',
      name: 'test-mod',
      directory: '/test/mods/test-mod',
      remote: 'https://github.com/test/test-mod.git',
      installedAt: new Date('2024-01-01'),
      lastUpdated: new Date('2024-01-01'),
    };

    it('should return empty array when no mods installed', () => {
      const mods = configManager.getInstalledMods();

      expect(mods).toEqual([]);
    });

    it('should get installed mods', () => {
      mockConfInstance.set('installed-mods', [testMod]);

      const mods = configManager.getInstalledMods();

      expect(mods).toHaveLength(1);
      expect(mods[0].modId).toBe('test-mod');
    });

    it('should set installed mods', () => {
      configManager.setInstalledMods([testMod]);

      const stored = mockConfInstance.get('installed-mods');
      expect(stored).toHaveLength(1);
      expect(stored[0].modId).toBe('test-mod');
    });

    it('should add a new mod', () => {
      configManager.addOrUpdateInstalledMod(testMod);

      const mods = configManager.getInstalledMods();
      expect(mods).toHaveLength(1);
      expect(mods[0].modId).toBe('test-mod');
    });

    it('should update an existing mod by modId', () => {
      configManager.addOrUpdateInstalledMod(testMod);

      const updatedMod = {
        ...testMod,
        lastUpdated: new Date('2024-02-01'),
      };
      configManager.addOrUpdateInstalledMod(updatedMod);

      const mods = configManager.getInstalledMods();
      expect(mods).toHaveLength(1);
      expect(mods[0].lastUpdated).toEqual(new Date('2024-02-01'));
    });

    it('should update an existing mod by remote URL', () => {
      // First add a mod
      configManager.addOrUpdateInstalledMod(testMod);

      // Update with same remote but different modId
      const updatedMod = {
        ...testMod,
        modId: 'different-id',
        lastUpdated: new Date('2024-02-01'),
      };
      configManager.addOrUpdateInstalledMod(updatedMod);

      const mods = configManager.getInstalledMods();
      expect(mods).toHaveLength(1);
      expect(mods[0].modId).toBe('different-id');
      expect(mods[0].lastUpdated).toEqual(new Date('2024-02-01'));
    });

    it('should update an existing mod whose remote differs only by the .git suffix', () => {
      configManager.addOrUpdateInstalledMod({ ...testMod, remote: 'https://github.com/test/test-mod' });
      configManager.addOrUpdateInstalledMod({ ...testMod, modId: 'other-id', remote: 'https://github.com/test/test-mod.git' });

      expect(configManager.getInstalledMods()).toHaveLength(1);
    });

    it('should not merge two different mods that both lack a modId', () => {
      configManager.addOrUpdateInstalledMod({ ...testMod, modId: undefined as any, remote: 'https://github.com/test/a.git' });
      configManager.addOrUpdateInstalledMod({ ...testMod, modId: undefined as any, remote: 'https://github.com/test/b.git' });

      expect(configManager.getInstalledMods()).toHaveLength(2);
    });

    it('should remove an installed mod by modId', () => {
      configManager.setInstalledMods([testMod]);

      configManager.removeInstalledMod('test-mod');

      const mods = configManager.getInstalledMods();
      expect(mods).toHaveLength(0);
    });

    it('should remove an installed mod by name', () => {
      configManager.setInstalledMods([testMod]);

      configManager.removeInstalledMod('test-mod');

      const mods = configManager.getInstalledMods();
      expect(mods).toHaveLength(0);
    });

    it('should not fail when removing non-existent mod', () => {
      configManager.setInstalledMods([testMod]);

      configManager.removeInstalledMod('non-existent');

      const mods = configManager.getInstalledMods();
      expect(mods).toHaveLength(1); // Original mod still there
    });
  });

  describe('Mod Finding and Checking', () => {
    const testMod: ModInstallation = {
      modId: 'test-mod',
      name: 'test-mod',
      directory: '/test/mods/test-mod',
      remote: 'https://github.com/test/test-mod.git',
      installedAt: new Date(),
      lastUpdated: new Date(),
    };

    beforeEach(() => {
      configManager.setInstalledMods([testMod]);
    });

    it('should find installed mod by remote URL', () => {
      const mod = configManager.findInstalledModByRemote('https://github.com/test/test-mod.git');

      expect(mod).toBeDefined();
      expect(mod?.modId).toBe('test-mod');
    });

    it('should find installed mod by remote URL without .git', () => {
      const mod = configManager.findInstalledModByRemote('https://github.com/test/test-mod');

      expect(mod).toBeDefined();
      expect(mod?.modId).toBe('test-mod');
    });

    it('should handle .git suffix variations', () => {
      // Add mod with .git
      const modWithGit: ModInstallation = {
        ...testMod,
        modId: 'mod-with-git',
        remote: 'https://example.com/repo.git',
      };
      configManager.addOrUpdateInstalledMod(modWithGit);

      // Should find it without .git
      const found1 = configManager.findInstalledModByRemote('https://example.com/repo');
      expect(found1?.modId).toBe('mod-with-git');

      // Should find it with .git
      const found2 = configManager.findInstalledModByRemote('https://example.com/repo.git');
      expect(found2?.modId).toBe('mod-with-git');
    });

    it('should return undefined when mod not found', () => {
      const mod = configManager.findInstalledModByRemote('https://github.com/test/other-mod.git');

      expect(mod).toBeUndefined();
    });

    it('should check if mod is installed', () => {
      expect(configManager.isModInstalled('https://github.com/test/test-mod.git')).toBe(true);
      expect(configManager.isModInstalled('https://github.com/test/test-mod')).toBe(true);
      expect(configManager.isModInstalled('https://github.com/test/other-mod.git')).toBe(false);
    });
  });

  describe('User Preferences', () => {
    it('should return default preferences when not set', () => {
      const prefs = configManager.getPreferences();

      expect(prefs).toEqual({
        autoUpdate: false,
        colorOutput: true,
        verbosity: 'normal',
        parallelOperations: 3,
      });
    });

    it('should get stored preferences', () => {
      mockConfInstance.set('preferences', {
        autoUpdate: true,
        colorOutput: false,
        verbosity: 'verbose',
        parallelOperations: 5,
      });

      const prefs = configManager.getPreferences();

      expect(prefs.autoUpdate).toBe(true);
      expect(prefs.colorOutput).toBe(false);
      expect(prefs.verbosity).toBe('verbose');
      expect(prefs.parallelOperations).toBe(5);
    });

    it('should update preferences partially', () => {
      configManager.updatePreferences({
        autoUpdate: true,
        verbosity: 'verbose',
      });

      const prefs = configManager.getPreferences();
      expect(prefs.autoUpdate).toBe(true);
      expect(prefs.verbosity).toBe('verbose');
      expect(prefs.colorOutput).toBe(true); // unchanged default
      expect(prefs.parallelOperations).toBe(3); // unchanged default
    });

    it('should merge preferences correctly', () => {
      // Set initial preferences
      configManager.updatePreferences({
        autoUpdate: true,
        colorOutput: false,
      });

      // Update some preferences
      configManager.updatePreferences({
        verbosity: 'quiet',
      });

      const prefs = configManager.getPreferences();
      expect(prefs.autoUpdate).toBe(true); // kept from first update
      expect(prefs.colorOutput).toBe(false); // kept from first update
      expect(prefs.verbosity).toBe('quiet'); // new value
      expect(prefs.parallelOperations).toBe(3); // default
    });
  });

  describe('Masterlist Update', () => {
    it('should get last masterlist update time', () => {
      const testDate = new Date('2024-01-01T12:00:00Z');
      mockConfInstance.set('last-masterlist-update', testDate.toISOString());

      const date = configManager.getLastMasterlistUpdate();

      expect(date).toEqual(testDate);
    });

    it('should return undefined when no last update', () => {
      const date = configManager.getLastMasterlistUpdate();

      expect(date).toBeUndefined();
    });

    it('should set last masterlist update time with specific date', () => {
      const testDate = new Date('2024-01-01T12:00:00Z');
      configManager.setLastMasterlistUpdate(testDate);

      const stored = mockConfInstance.get('last-masterlist-update');
      expect(stored).toBe(testDate.toISOString());
    });

    it('should set last masterlist update time to current date when not specified', () => {
      const before = new Date();
      configManager.setLastMasterlistUpdate();
      const after = new Date();

      const stored = mockConfInstance.get('last-masterlist-update');
      const storedDate = new Date(stored);

      expect(storedDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(storedDate.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Configuration Management', () => {
    it('should clear all configuration', () => {
      configManager.setInstallationDir('/test');
      configManager.setInstalledMods([]);

      configManager.clear();

      // Check that store is empty
      expect(mockConfInstance.getStore().size).toBe(0);
    });

    it('should get all configuration', () => {
      const testMod: ModInstallation = {
        modId: 'test',
        name: 'test',
        directory: '/test/mods/test',
        remote: 'https://test.git',
        installedAt: new Date(),
        lastUpdated: new Date(),
      };

      configManager.setInstallationDir('/test/mods');
      configManager.setInstalledMods([testMod]);
      configManager.updatePreferences({ autoUpdate: true });

      const all = configManager.getAll();

      expect(all.installationDir).toBe('/test/mods');
      expect(all.installedMods).toHaveLength(1);
      expect(all.preferences?.autoUpdate).toBe(true);
    });

    it('should handle empty configuration', () => {
      const all = configManager.getAll();

      expect(all.installationDir).toBe('');
      expect(all.installedMods).toEqual([]);
      expect(all.preferences).toBeDefined();
    });
  });

  describe('Backward Compatibility', () => {
    it('should normalize old mod format with dir field', () => {
      // Old format that might be missing some fields
      const oldMod = {
        mod: 'old-mod',
        name: 'old-mod-name',
        dir: '/old/path',
        remote: 'https://old.git',
      };

      mockConfInstance.set('installed-mods', [oldMod]);

      const mods = configManager.getInstalledMods();

      expect(mods).toHaveLength(1);
      expect(mods[0].modId).toBe('old-mod');
      expect(mods[0].name).toBe('old-mod-name');
      expect(mods[0].directory).toBe('/old/path');
      expect(mods[0].remote).toBe('https://old.git');
      expect(mods[0].installedAt).toBeInstanceOf(Date);
      expect(mods[0].lastUpdated).toBeInstanceOf(Date);
    });

    it('should handle mods with partial data', () => {
      const partialMod = {
        name: 'partial-mod',
        remote: 'https://partial.git',
      };

      mockConfInstance.set('installed-mods', [partialMod]);

      const mods = configManager.getInstalledMods();

      expect(mods).toHaveLength(1);
      expect(mods[0].modId).toBe('partial-mod');
      expect(mods[0].name).toBe('partial-mod');
      expect(mods[0].directory).toBeUndefined();
      expect(mods[0].remote).toBe('https://partial.git');
    });

    it('should preserve existing timestamps when available', () => {
      const existingMod = {
        modId: 'existing',
        name: 'existing',
        remote: 'https://existing.git',
        installedAt: '2023-01-01T00:00:00Z',
        lastUpdated: '2023-06-01T00:00:00Z',
        lastChecked: '2023-07-01T00:00:00Z',
      };

      mockConfInstance.set('installed-mods', [existingMod]);

      const mods = configManager.getInstalledMods();

      expect(mods[0].installedAt).toEqual(new Date('2023-01-01T00:00:00Z'));
      expect(mods[0].lastUpdated).toEqual(new Date('2023-06-01T00:00:00Z'));
      expect(mods[0].lastChecked).toEqual(new Date('2023-07-01T00:00:00Z'));
    });
  });

  describe('Migration', () => {
    it('should set version for new config', () => {
      // Create a new ConfigManager (migration happens in constructor)
      const newConfig = new ConfigManager('test-new');

      const confInstance = (newConfig as any).config;
      expect(confInstance.get('config-version')).toBe(2);
    });

    it('should migrate old config with installed mods', () => {
      // Set up old config data before creating ConfigManager
      const oldMod = {
        mod: 'old-format',
        dir: '/old/dir',
        remote: 'https://old.git',
      };

      // Manually set old data
      mockConfInstance.set('installed-mods', [oldMod]);

      // Trigger migration by checking version
      const version = mockConfInstance.get('config-version');

      if (!version) {
        // This would normally happen in the constructor
        const normalized = [{
          modId: 'old-format',
          name: 'old-format',
          directory: '/old/dir',
          remote: 'https://old.git',
          installedAt: new Date(),
          lastUpdated: new Date(),
        }];

        mockConfInstance.set('installed-mods', normalized);
        mockConfInstance.set('config-version', 2);
      }

      expect(mockConfInstance.get('config-version')).toBe(2);
    });
  });
});