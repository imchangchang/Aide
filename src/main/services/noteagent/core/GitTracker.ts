import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import git from 'isomorphic-git'

const logger = loggerService.withContext('GitTracker')

export interface CommitInfo {
  oid: string
  message: string
  author: {
    name: string
    email: string
    timestamp: number
  }
  committer: {
    name: string
    email: string
    timestamp: number
  }
}

export interface DiffEntry {
  path: string
  type: 'added' | 'modified' | 'deleted' | 'renamed'
}

export interface StatusEntry {
  path: string
  status: 'unmodified' | 'added' | 'modified' | 'deleted' | 'untracked'
}

/**
 * Lightweight git wrapper using isomorphic-git.
 *
 * All operations are local (no remote). Used by Note Agent to track
 * knowledge base changes via git commits.
 */
export class GitTracker {
  private readonly dir: string
  private readonly author = { name: 'NoteAgent', email: 'agent@cherrystudio.app' }

  constructor(repoPath: string) {
    this.dir = repoPath
  }

  /**
   * Initialize a new git repository at the configured path.
   * No-op if .git already exists.
   */
  async init(defaultBranch = 'main'): Promise<void> {
    const gitDir = path.join(this.dir, '.git')
    try {
      await fs.promises.access(gitDir)
      logger.debug('Git repo already initialized', { dir: this.dir })
      return
    } catch {
      // .git does not exist — proceed with init
    }

    await git.init({ fs, dir: this.dir, defaultBranch })
    logger.info('Git repo initialized', { dir: this.dir, defaultBranch })
  }

  /**
   * Stage a file (or all changes if filepath is omitted).
   */
  async add(filepath?: string): Promise<void> {
    if (filepath) {
      await git.add({ fs, dir: this.dir, filepath })
      logger.debug('Staged file', { filepath })
    } else {
      // Stage all tracked changes + new files
      const statuses = await this.statusAll()
      for (const entry of statuses) {
        if (entry.status !== 'unmodified') {
          await git.add({ fs, dir: this.dir, filepath: entry.path })
        }
      }
      logger.debug('Staged all changes', { count: statuses.length })
    }
  }

  /**
   * Create a commit with the given message.
   */
  async commit(message: string): Promise<string> {
    const oid = await git.commit({
      fs,
      dir: this.dir,
      message,
      author: this.author
    })
    logger.info('Git commit created', { oid: oid.slice(0, 7), message })
    return oid
  }

  /**
   * Convenience: stage all + commit.
   */
  async stageAndCommit(message: string): Promise<string> {
    await this.add()
    return this.commit(message)
  }

  /**
   * Get commit history (newest first).
   */
  async log(options?: { depth?: number; ref?: string }): Promise<CommitInfo[]> {
    const commits = await git.log({
      fs,
      dir: this.dir,
      depth: options?.depth ?? 20,
      ref: options?.ref ?? 'HEAD'
    })
    return commits.map((c) => ({
      oid: c.oid,
      message: c.commit.message.trim(),
      author: {
        name: c.commit.author.name,
        email: c.commit.author.email,
        timestamp: c.commit.author.timestamp
      },
      committer: {
        name: c.commit.committer.name,
        email: c.commit.committer.email,
        timestamp: c.commit.committer.timestamp
      }
    }))
  }

  /**
   * Get status of a single file.
   */
  async status(filepath: string): Promise<StatusEntry> {
    const statusCode = await git.status({ fs, dir: this.dir, filepath })
    return {
      path: filepath,
      status: this.mapStatus(statusCode)
    }
  }

  /**
   * Get status of all files in the repo.
   */
  async statusAll(): Promise<StatusEntry[]> {
    const matrix = await git.statusMatrix({ fs, dir: this.dir })
    // statusMatrix returns [filepath, headStatus, workdirStatus, stageStatus]
    // 1 = present, 0 = absent
    return matrix.map(([filepath, headStatus, workdirStatus, stageStatus]) => ({
      path: filepath,
      status: this.mapStatusFromMatrix(headStatus as number, workdirStatus as number, stageStatus as number)
    }))
  }

  /**
   * Show diff between two commits (or working tree vs HEAD).
   */
  async diff(refA?: string, refB?: string): Promise<DiffEntry[]> {
    // For simplicity, return file-level changes between two trees.
    // isomorphic-git doesn't have a high-level diff command,
    // so we use statusMatrix for working tree vs HEAD comparison.
    if (!refA && !refB) {
      // Working tree vs HEAD
      const matrix = await git.statusMatrix({ fs, dir: this.dir })
      return matrix
        .filter(([, head, workdir]) => head !== workdir)
        .map(([filepath, head, workdir]) => {
          const fp = filepath
          let type: DiffEntry['type']
          if (head === 0 && workdir === 1) type = 'added'
          else if (head === 1 && workdir === 0) type = 'deleted'
          else type = 'modified'
          return { path: fp, type }
        })
    }

    // For commit-to-commit diff, we'd need to walk trees.
    // This is a simplified version for the Note Agent use case.
    logger.warn('Commit-to-commit diff not fully implemented', { refA, refB })
    return []
  }

  /**
   * Check if the repo has any commits.
   */
  async hasCommits(): Promise<boolean> {
    try {
      await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' })
      return true
    } catch {
      return false
    }
  }

  private mapStatus(status: string): StatusEntry['status'] {
    switch (status) {
      case '*unmodified':
        return 'unmodified'
      case '*added':
      case 'added':
        return 'added'
      case '*modified':
      case 'modified':
        return 'modified'
      case '*deleted':
      case 'deleted':
        return 'deleted'
      case '*untracked':
      case 'untracked':
        return 'untracked'
      default:
        return 'unmodified'
    }
  }

  private mapStatusFromMatrix(head: number, workdir: number, stage: number): StatusEntry['status'] {
    // head  workdir  stage  |  meaning
    //   0      0       0    |  absent
    //   0      0       1    |  deleted (staged)
    //   0      1       0    |  added (untracked)
    //   0      1       1    |  added (staged)
    //   1      0       0    |  deleted
    //   1      0       1    |  deleted (staged)
    //   1      1       0    |  modified (unstaged)
    //   1      1       1    |  unmodified
    if (head === 0 && workdir === 1) return 'added'
    if (head === 1 && workdir === 0) return 'deleted'
    if (head === 1 && workdir === 1 && stage === 0) return 'modified'
    if (head === 0 && workdir === 0) return 'unmodified'
    if (head === 1 && workdir === 1 && stage === 1) return 'unmodified'
    return 'unmodified'
  }
}
