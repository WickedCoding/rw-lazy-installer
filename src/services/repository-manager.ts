import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import type { GitPullResult, GitStatus } from '../types/git';

/**
 * Service for managing Git repositories for mod installations
 * Provides a simple wrapper around Git operations needed for mod management
 */
export class RepositoryManager {
  private git: SimpleGit;
  private gitOptions: Partial<SimpleGitOptions>;

  constructor(options?: Partial<SimpleGitOptions>) {
    // Configure options to prevent authentication prompts
    // We use 'env' command to set environment variables that prevent Git from asking for credentials
    this.gitOptions = {
      ...options,
      // Add a timeout to prevent hanging on auth
      timeout: {
        block: 30000,  // 30 seconds max for any operation
        ...options?.timeout,
      },
    };

    // Create git instance with auth blocking
    this.git = simpleGit(this.gitOptions);
  }

  /**
   * Clone a repository to a destination directory.
   * Checks out `branch` when given, otherwise the remote's default branch.
   */
  async cloneRepository(url: string, destination: string, branch?: string): Promise<void> {
    try {
      if (branch) {
        await this.git.clone(url, destination, ['--branch', branch]);
      } else {
        await this.git.clone(url, destination);
      }
    } catch (error) {
      throw new Error(`Failed to clone repository from ${url}: ${(error as Error).message}`);
    }
  }

  /**
   * Update a repository (fetch and pull)
   */
  async updateRepository(path: string): Promise<GitPullResult> {
    try {
      // Create repo instance with auth blocking
      const repo = simpleGit({
        ...this.gitOptions,
        baseDir: path,
      });

      // Get current commit before update
      const beforeCommit = await repo.revparse(['HEAD']);

      // Fetch and pull
      await repo.fetch();
      await repo.pull();

      // Get commit after update
      const afterCommit = await repo.revparse(['HEAD']);

      return {
        success: true,
        hasChanges: beforeCommit !== afterCommit,
      };
    } catch (error) {
      return {
        success: false,
        hasChanges: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get repository status and current commit
   */
  async getRepositoryStatus(path: string): Promise<GitStatus> {
    try {
      const repo = simpleGit({
        ...this.gitOptions,
        baseDir: path,
      });

      // Check if it's a valid Git repository
      const isRepo = await repo.checkIsRepo();
      if (!isRepo) {
        return {
          isValidRepo: false,
        };
      }

      // Get current commit hash
      const currentCommit = await repo.revparse(['HEAD']);

      // Get remote URL
      const remotes = await repo.getRemotes(true);
      const remoteUrl = remotes.length > 0 && remotes[0]?.refs.fetch ? remotes[0].refs.fetch : undefined;

      return {
        isValidRepo: true,
        currentCommit,
        remoteUrl,
      };
    } catch (error) {
      return {
        isValidRepo: false,
      };
    }
  }

  /**
   * Get the remote URL of a repository
   */
  async getRemoteUrl(path: string): Promise<string | undefined> {
    try {
      const repo = simpleGit({
        ...this.gitOptions,
        baseDir: path,
      });
      const remotes = await repo.getRemotes(true);
      return remotes.length > 0 && remotes[0]?.refs.fetch ? remotes[0].refs.fetch : undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Get recent commit messages (for changelog)
   */
  async getRecentCommits(path: string, limit: number = 5): Promise<Array<{ hash: string; message: string }>> {
    try {
      const repo = simpleGit({
        ...this.gitOptions,
        baseDir: path,
      });
      const log = await repo.log({ '--max-count': limit });

      return log.all.map(commit => ({
        hash: commit.hash.substring(0, 6),
        message: commit.message,
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get current commit hash
   */
  async getCurrentCommit(path: string): Promise<string | undefined> {
    try {
      const repo = simpleGit({
        ...this.gitOptions,
        baseDir: path,
      });
      return await repo.revparse(['HEAD']);
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Set the URL of the origin remote
   */
  async setRemoteUrl(path: string, url: string): Promise<void> {
    try {
      const repo = simpleGit({
        ...this.gitOptions,
        baseDir: path,
      });
      await repo.remote(['set-url', 'origin', url]);
    } catch (error) {
      throw new Error(`Failed to set remote URL on ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Name of the checked-out branch, or undefined for a detached HEAD or an unreadable repository
   */
  async getCurrentBranch(path: string): Promise<string | undefined> {
    try {
      const repo = simpleGit({
        ...this.gitOptions,
        baseDir: path,
      });
      const branch = (await repo.revparse(['--abbrev-ref', 'HEAD'])).trim();
      return branch && branch !== 'HEAD' ? branch : undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Fetch origin and switch to `branch`, tracking `origin/<branch>`.
   * Reuses an existing local branch of that name, otherwise creates it from the remote branch.
   */
  async checkoutBranch(path: string, branch: string): Promise<void> {
    try {
      const repo = simpleGit({
        ...this.gitOptions,
        baseDir: path,
      });
      await repo.fetch('origin');
      const local = await repo.branchLocal();
      if (local.all.includes(branch)) {
        await repo.checkout(branch);
        await repo.branch(['--set-upstream-to', `origin/${branch}`, branch]);
      } else {
        await repo.checkout(['-b', branch, '--track', `origin/${branch}`]);
      }
    } catch (error) {
      throw new Error(`Failed to switch ${path} to branch ${branch}: ${(error as Error).message}`);
    }
  }

  /**
   * Check whether the working tree has uncommitted changes
   */
  async hasUncommittedChanges(path: string): Promise<boolean> {
    const repo = simpleGit({
      ...this.gitOptions,
      baseDir: path,
    });
    const status = await repo.status();
    return !status.isClean();
  }
}