/**
 * Core domain types for mod management
 */

/**
 * Represents a mod definition from the registry
 */
export interface Mod {
  /** Unique identifier (usually same as name) */
  id: string;

  /** Folder name for installation */
  name: string;

  /** Display name for the mod */
  label: string;

  /** Git repository URL */
  remote: string;

  /** Branch to clone; the remote's default branch is used when omitted */
  branch?: string;

  /** Remotes this mod was hosted at before it moved; installs still pointing there can be relinked */
  previousRemotes?: string[];

  /** Additional notes or warnings */
  remark?: string;

  /** Whether the mod is deprecated */
  deprecated?: boolean;

  /** Supported RimWorld versions (extracted from About.xml) */
  supportedVersions?: string[];
}

/**
 * Represents an installed mod with metadata
 */
export interface ModInstallation {
  /** Reference to the mod definition */
  modId: string;

  /** Installation folder name */
  name: string;

  /** Full path to installation directory */
  directory: string;

  /** Git remote URL */
  remote: string;

  /** Current Git commit hash */
  installedVersion?: string;

  /** Detected RimWorld versions from About.xml */
  supportedVersions?: string[];

  /** Installation timestamp */
  installedAt: Date;

  /** Last update timestamp */
  lastUpdated: Date;

  /** Last time we checked for updates */
  lastChecked?: Date;
}

/**
 * Result of an update operation
 */
export interface UpdateResult {
  /** Mod identifier */
  modId: string;

  /** Whether update succeeded */
  success: boolean;

  /** Previous Git commit hash */
  previousVersion?: string;

  /** New Git commit hash */
  newVersion?: string;

  /** Whether any changes were pulled */
  hasChanges: boolean;

  /** Error if update failed */
  error?: Error;

  /** Time taken in milliseconds */
  duration: number;
}

/**
 * Options for update operations
 */
export interface UpdateOptions {
  /** Force update even if no changes */
  force?: boolean;

  /** Update in parallel */
  parallel?: boolean;

  /** Maximum concurrent updates */
  concurrency?: number;

  /** Show detailed output */
  verbose?: boolean;
}

/**
 * Filter options for listing/searching mods
 */
export interface ModFilter {
  /** Include deprecated mods */
  includeDeprecated?: boolean;

  /** Filter by RimWorld version */
  rimworldVersion?: string;

  /** Filter by installation status */
  installed?: boolean;

  /** Search term for name/label */
  searchTerm?: string;
}

/**
 * Report from installation check
 */
export interface InstallationReport {
  /** Total mods in registry */
  totalMods: number;

  /** Currently installed mods */
  installedMods: number;

  /** Mods with corrupted Git repos */
  corruptedMods: string[];

  /** Mods in config but missing from disk */
  missingMods: string[];

  /** Mods on disk but not in registry */
  unknownMods: string[];

  /** Suggested actions */
  recommendations: string[];
}

/**
 * Result of a validation check
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors */
  errors: string[];

  /** Validation warnings */
  warnings: string[];
}