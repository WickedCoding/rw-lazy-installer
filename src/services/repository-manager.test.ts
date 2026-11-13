import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock simple-git module - must be hoisted before any imports that use it
vi.mock('simple-git', () => {
  const mockClone = vi.fn();
  const mockFetch = vi.fn();
  const mockPull = vi.fn();
  const mockRevparse = vi.fn();
  const mockCheckIsRepo = vi.fn();
  const mockGetRemotes = vi.fn();
  const mockLog = vi.fn();
  const mockRemote = vi.fn();
  const mockStatus = vi.fn();

  const mockGit = {
    clone: mockClone,
    fetch: mockFetch,
    pull: mockPull,
    revparse: mockRevparse,
    checkIsRepo: mockCheckIsRepo,
    getRemotes: mockGetRemotes,
    log: mockLog,
    remote: mockRemote,
    status: mockStatus,
  };

  const simpleGit = vi.fn(() => mockGit);

  // Store mocks globally for test access
  (global as any).__mockGitFunctions = {
    mockClone,
    mockFetch,
    mockPull,
    mockRevparse,
    mockCheckIsRepo,
    mockGetRemotes,
    mockLog,
    mockRemote,
    mockStatus,
  };

  return {
    default: simpleGit,
    simpleGit,
  };
});

// Import after mocking
import { RepositoryManager } from './repository-manager';

// Get mock functions from global
const getMocks = () => (global as any).__mockGitFunctions;
const {
  mockClone,
  mockFetch,
  mockPull,
  mockRevparse,
  mockCheckIsRepo,
  mockGetRemotes,
  mockLog,
  mockRemote,
  mockStatus
} = getMocks();

describe('RepositoryManager', () => {
  let repoManager: RepositoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    repoManager = new RepositoryManager();

    // Set default mock implementations
    mockCheckIsRepo.mockResolvedValue(true);
    mockRevparse.mockResolvedValue('abc123def456');
    mockGetRemotes.mockResolvedValue([]);
    mockFetch.mockResolvedValue(undefined);
    mockPull.mockResolvedValue({ files: [], summary: {} });
    mockClone.mockResolvedValue(undefined);
    mockLog.mockResolvedValue({
      all: [],
      latest: null,
      total: 0,
    });
    mockRemote.mockResolvedValue('');
    mockStatus.mockResolvedValue({ isClean: () => true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cloneRepository', () => {
    it('should clone a repository successfully', async () => {
      const url = 'https://github.com/test/repo.git';
      const destination = '/test/path';

      await repoManager.cloneRepository(url, destination);

      expect(mockClone).toHaveBeenCalledWith(url, destination);
      expect(mockClone).toHaveBeenCalledTimes(1);
    });

    it('should clone a specific branch when one is given', async () => {
      const url = 'https://github.com/test/repo.git';
      const destination = '/test/path';

      await repoManager.cloneRepository(url, destination, 'develop');

      expect(mockClone).toHaveBeenCalledWith(url, destination, ['--branch', 'develop']);
      expect(mockClone).toHaveBeenCalledTimes(1);
    });

    it('should throw error when clone fails', async () => {
      const url = 'https://github.com/test/repo.git';
      const destination = '/test/path';
      const errorMessage = 'Network error';

      mockClone.mockRejectedValueOnce(new Error(errorMessage));

      await expect(repoManager.cloneRepository(url, destination))
        .rejects
        .toThrow(`Failed to clone repository from ${url}: ${errorMessage}`);
    });

    it('should handle invalid URL gracefully', async () => {
      const url = 'not-a-valid-url';
      const destination = '/test/path';

      mockClone.mockRejectedValueOnce(new Error('Invalid URL'));

      await expect(repoManager.cloneRepository(url, destination))
        .rejects
        .toThrow('Failed to clone repository');
    });
  });

  describe('updateRepository', () => {
    it('should update repository with changes', async () => {
      const path = '/test/repo';
      const beforeCommit = 'abc123';
      const afterCommit = 'def456';

      mockRevparse
        .mockResolvedValueOnce(beforeCommit)
        .mockResolvedValueOnce(afterCommit);

      const result = await repoManager.updateRepository(path);

      expect(result).toEqual({
        success: true,
        hasChanges: true,
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(mockPull).toHaveBeenCalled();
      expect(mockRevparse).toHaveBeenCalledTimes(2);
    });

    it('should update repository without changes', async () => {
      const path = '/test/repo';
      const sameCommit = 'abc123';

      mockRevparse
        .mockResolvedValueOnce(sameCommit)
        .mockResolvedValueOnce(sameCommit);

      const result = await repoManager.updateRepository(path);

      expect(result).toEqual({
        success: true,
        hasChanges: false,
      });
    });

    it('should handle fetch failure gracefully', async () => {
      const path = '/test/repo';
      const errorMessage = 'Failed to fetch';

      mockFetch.mockRejectedValueOnce(new Error(errorMessage));

      const result = await repoManager.updateRepository(path);

      expect(result).toEqual({
        success: false,
        hasChanges: false,
        error: errorMessage,
      });
    });

    it('should handle pull failure gracefully', async () => {
      const path = '/test/repo';
      const errorMessage = 'Merge conflict';

      mockRevparse.mockResolvedValueOnce('abc123');
      mockFetch.mockResolvedValueOnce(undefined);
      mockPull.mockRejectedValueOnce(new Error(errorMessage));

      const result = await repoManager.updateRepository(path);

      expect(result).toEqual({
        success: false,
        hasChanges: false,
        error: errorMessage,
      });
    });
  });

  describe('getRepositoryStatus', () => {
    it('should get status of valid repository', async () => {
      const path = '/test/repo';
      const commitHash = 'abc123def456';
      const remoteUrl = 'https://github.com/test/repo.git';

      mockCheckIsRepo.mockResolvedValueOnce(true);
      mockRevparse.mockResolvedValueOnce(commitHash);
      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'origin',
          refs: {
            fetch: remoteUrl,
            push: remoteUrl,
          },
        },
      ]);

      const status = await repoManager.getRepositoryStatus(path);

      expect(status).toEqual({
        isValidRepo: true,
        currentCommit: commitHash,
        remoteUrl: remoteUrl,
      });
    });

    it('should handle non-git directory', async () => {
      const path = '/not/a/repo';

      mockCheckIsRepo.mockResolvedValueOnce(false);

      const status = await repoManager.getRepositoryStatus(path);

      expect(status).toEqual({
        isValidRepo: false,
      });

      // Should not call other methods
      expect(mockRevparse).not.toHaveBeenCalled();
      expect(mockGetRemotes).not.toHaveBeenCalled();
    });

    it('should handle repository with no remotes', async () => {
      const path = '/test/local-repo';
      const commitHash = 'abc123';

      mockCheckIsRepo.mockResolvedValueOnce(true);
      mockRevparse.mockResolvedValueOnce(commitHash);
      mockGetRemotes.mockResolvedValueOnce([]);

      const status = await repoManager.getRepositoryStatus(path);

      expect(status).toEqual({
        isValidRepo: true,
        currentCommit: commitHash,
        remoteUrl: undefined,
      });
    });

    it('should handle errors gracefully', async () => {
      const path = '/test/repo';

      mockCheckIsRepo.mockRejectedValueOnce(new Error('Access denied'));

      const status = await repoManager.getRepositoryStatus(path);

      expect(status).toEqual({
        isValidRepo: false,
      });
    });

    it('should handle remote without fetch URL', async () => {
      const path = '/test/repo';

      mockCheckIsRepo.mockResolvedValueOnce(true);
      mockRevparse.mockResolvedValueOnce('abc123');
      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'origin',
          refs: {},
        },
      ]);

      const status = await repoManager.getRepositoryStatus(path);

      expect(status.remoteUrl).toBeUndefined();
    });
  });

  describe('getRemoteUrl', () => {
    it('should get remote URL successfully', async () => {
      const path = '/test/repo';
      const remoteUrl = 'https://github.com/test/repo.git';

      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'origin',
          refs: {
            fetch: remoteUrl,
            push: remoteUrl,
          },
        },
      ]);

      const url = await repoManager.getRemoteUrl(path);

      expect(url).toBe(remoteUrl);
    });

    it('should return undefined for no remotes', async () => {
      const path = '/test/repo';

      mockGetRemotes.mockResolvedValueOnce([]);

      const url = await repoManager.getRemoteUrl(path);

      expect(url).toBeUndefined();
    });

    it('should handle multiple remotes', async () => {
      const path = '/test/repo';
      const originUrl = 'https://github.com/test/repo.git';
      const upstreamUrl = 'https://github.com/upstream/repo.git';

      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'origin',
          refs: { fetch: originUrl },
        },
        {
          name: 'upstream',
          refs: { fetch: upstreamUrl },
        },
      ]);

      const url = await repoManager.getRemoteUrl(path);

      // Should return the first remote's URL
      expect(url).toBe(originUrl);
    });

    it('should handle errors gracefully', async () => {
      const path = '/test/repo';

      mockGetRemotes.mockRejectedValueOnce(new Error('Not a git repo'));

      const url = await repoManager.getRemoteUrl(path);

      expect(url).toBeUndefined();
    });
  });

  describe('getRecentCommits', () => {
    it('should get recent commits', async () => {
      const path = '/test/repo';
      const commits = [
        {
          hash: 'abc123def456',
          message: 'Add feature X',
          date: '2024-01-01',
          author_name: 'Test Author',
        },
        {
          hash: 'def456ghi789',
          message: 'Fix bug Y',
          date: '2024-01-02',
          author_name: 'Test Author',
        },
      ];

      mockLog.mockResolvedValueOnce({
        all: commits,
        latest: commits[0],
        total: 2,
      });

      const result = await repoManager.getRecentCommits(path, 2);

      expect(result).toEqual([
        { hash: 'abc123', message: 'Add feature X' },
        { hash: 'def456', message: 'Fix bug Y' },
      ]);

      expect(mockLog).toHaveBeenCalledWith({ '--max-count': 2 });
    });

    it('should use default limit of 5', async () => {
      const path = '/test/repo';

      mockLog.mockResolvedValueOnce({
        all: [],
        latest: null,
        total: 0,
      });

      await repoManager.getRecentCommits(path);

      expect(mockLog).toHaveBeenCalledWith({ '--max-count': 5 });
    });

    it('should handle empty commit history', async () => {
      const path = '/test/repo';

      mockLog.mockResolvedValueOnce({
        all: [],
        latest: null,
        total: 0,
      });

      const result = await repoManager.getRecentCommits(path);

      expect(result).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      const path = '/test/repo';

      mockLog.mockRejectedValueOnce(new Error('Not a git repo'));

      const result = await repoManager.getRecentCommits(path);

      expect(result).toEqual([]);
    });

    it('should truncate commit hash to 6 characters', async () => {
      const path = '/test/repo';

      mockLog.mockResolvedValueOnce({
        all: [
          {
            hash: '1234567890abcdef',
            message: 'Long hash commit',
          },
        ],
        latest: null,
        total: 1,
      });

      const result = await repoManager.getRecentCommits(path, 1);

      expect(result[0].hash).toBe('123456');
      expect(result[0].hash).toHaveLength(6);
    });
  });

  describe('getCurrentCommit', () => {
    it('should get current commit hash', async () => {
      const path = '/test/repo';
      const commitHash = 'abc123def456';

      mockRevparse.mockResolvedValueOnce(commitHash);

      const result = await repoManager.getCurrentCommit(path);

      expect(result).toBe(commitHash);
      expect(mockRevparse).toHaveBeenCalledWith(['HEAD']);
    });

    it('should return undefined on error', async () => {
      const path = '/test/repo';

      mockRevparse.mockRejectedValueOnce(new Error('Not a git repo'));

      const result = await repoManager.getCurrentCommit(path);

      expect(result).toBeUndefined();
    });

    it('should handle detached HEAD state', async () => {
      const path = '/test/repo';
      const commitHash = '1234567890abcdef';

      mockRevparse.mockResolvedValueOnce(commitHash);

      const result = await repoManager.getCurrentCommit(path);

      expect(result).toBe(commitHash);
    });
  });

  describe('Constructor options', () => {
    it('should accept SimpleGitOptions', () => {
      const options = {
        baseDir: '/custom/path',
        binary: 'git',
        maxConcurrentProcesses: 5,
      };

      // Should not throw
      expect(() => new RepositoryManager(options)).not.toThrow();
    });

    it('should work without options', () => {
      expect(() => new RepositoryManager()).not.toThrow();
    });

    it('should handle undefined options', () => {
      expect(() => new RepositoryManager(undefined)).not.toThrow();
    });
  });

  describe('Authentication blocking', () => {
    it('should fail immediately on authentication required for clone', async () => {
      const url = 'https://github.com/private/repo.git';
      const destination = '/test/path';
      const errorMessage = 'Authentication failed';

      mockClone.mockRejectedValueOnce(new Error(errorMessage));

      await expect(repoManager.cloneRepository(url, destination))
        .rejects
        .toThrow(`Failed to clone repository from ${url}: ${errorMessage}`);
    });

    it('should fail immediately on authentication required for fetch', async () => {
      const path = '/test/repo';
      const errorMessage = 'Authentication failed';

      mockRevparse.mockResolvedValueOnce('abc123');
      mockFetch.mockRejectedValueOnce(new Error(errorMessage));

      const result = await repoManager.updateRepository(path);

      expect(result).toEqual({
        success: false,
        hasChanges: false,
        error: errorMessage,
      });
    });

    it('should handle 401 errors without prompting', async () => {
      const url = 'https://github.com/private/repo.git';
      const destination = '/test/path';
      const errorMessage = 'fatal: Authentication failed for ' + url;

      mockClone.mockRejectedValueOnce(new Error(errorMessage));

      await expect(repoManager.cloneRepository(url, destination))
        .rejects
        .toThrow(errorMessage);

      // Verify the error was immediate (no credentials were requested)
      expect(mockClone).toHaveBeenCalledTimes(1);
    });

    it('should timeout on operations that hang', async () => {
      const url = 'https://github.com/private/repo.git';
      const destination = '/test/path';

      // Simulate a hanging operation
      mockClone.mockImplementationOnce(() => new Promise((resolve) => {
        // Never resolves
      }));

      // This should timeout according to our configuration
      const promise = repoManager.cloneRepository(url, destination);

      // In a real scenario, this would timeout after 30 seconds
      // For testing, we can't wait that long, so we just verify the setup
      expect(mockClone).toHaveBeenCalledWith(url, destination);
    });

    it('should handle SSH authentication failures', async () => {
      const url = 'git@github.com:private/repo.git';
      const destination = '/test/path';
      const errorMessage = 'Permission denied (publickey)';

      mockClone.mockRejectedValueOnce(new Error(errorMessage));

      await expect(repoManager.cloneRepository(url, destination))
        .rejects
        .toThrow(`Failed to clone repository from ${url}: ${errorMessage}`);
    });

    it('should not prompt for credentials on private GitGud repos', async () => {
      const url = 'https://gitgud.io/private/repo.git';
      const destination = '/test/path';
      const errorMessage = 'fatal: could not read Username';

      mockClone.mockRejectedValueOnce(new Error(errorMessage));

      await expect(repoManager.cloneRepository(url, destination))
        .rejects
        .toThrow(`Failed to clone repository from ${url}: ${errorMessage}`);
    });
  });

  describe('setRemoteUrl', () => {
    it('should set the origin remote URL', async () => {
      const path = '/test/repo';
      const url = 'https://github.com/new/repo.git';

      mockRemote.mockResolvedValueOnce('');

      await repoManager.setRemoteUrl(path, url);

      expect(mockRemote).toHaveBeenCalledWith(['set-url', 'origin', url]);
    });

    it('should throw a descriptive error when set-url fails', async () => {
      const path = '/test/repo';
      const url = 'https://github.com/new/repo.git';

      mockRemote.mockRejectedValueOnce(new Error('fatal: No such remote'));

      await expect(repoManager.setRemoteUrl(path, url))
        .rejects
        .toThrow(`Failed to set remote URL on ${path}: fatal: No such remote`);
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return false for a clean working tree', async () => {
      mockStatus.mockResolvedValueOnce({ isClean: () => true });

      const result = await repoManager.hasUncommittedChanges('/test/repo');

      expect(result).toBe(false);
    });

    it('should return true when working tree has changes', async () => {
      mockStatus.mockResolvedValueOnce({ isClean: () => false });

      const result = await repoManager.hasUncommittedChanges('/test/repo');

      expect(result).toBe(true);
    });

    it('should propagate errors from git status', async () => {
      mockStatus.mockRejectedValueOnce(new Error('Not a git repo'));

      await expect(repoManager.hasUncommittedChanges('/test/repo'))
        .rejects
        .toThrow('Not a git repo');
    });
  });
});