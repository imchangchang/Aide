import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'

import { GitTracker } from './GitTracker'

const logger = loggerService.withContext('WorkspaceInitializer')

export interface WorkspaceConfig {
  repoPath: string
  rawPath: string
  knowledgePath: string
  graphPath: string
}

/**
 * Initialize and manage a Note Agent workspace directory.
 *
 * A workspace is a git-tracked directory containing:
 * - raw/        : source documents (user input)
 * - knowledge/  : structured knowledge pages (agent output)
 * - graph/      : graph analysis artifacts (agent output)
 * - .git/       : change tracking
 */
export class WorkspaceInitializer {
  private readonly config: WorkspaceConfig

  constructor(repoPath: string) {
    this.config = {
      repoPath,
      rawPath: path.join(repoPath, 'raw'),
      knowledgePath: path.join(repoPath, 'knowledge'),
      graphPath: path.join(repoPath, 'graph')
    }
  }

  get paths(): WorkspaceConfig {
    return { ...this.config }
  }

  /**
   * Initialize the workspace if it doesn't exist.
   * Creates directory structure and initializes git.
   */
  async init(): Promise<WorkspaceConfig> {
    await this.ensureDirectories()
    await this.initGit()
    await this.createGitignore()

    logger.info('Workspace initialized', { repoPath: this.config.repoPath })
    return this.config
  }

  /**
   * Check if the workspace is already initialized.
   */
  async isInitialized(): Promise<boolean> {
    try {
      await fs.promises.access(path.join(this.config.repoPath, '.git'))
      return true
    } catch {
      return false
    }
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = [
      this.config.repoPath,
      this.config.rawPath,
      path.join(this.config.rawPath, 'notes'),
      path.join(this.config.rawPath, 'uploads'),
      this.config.knowledgePath,
      path.join(this.config.knowledgePath, 'sources'),
      path.join(this.config.knowledgePath, 'entities'),
      path.join(this.config.knowledgePath, 'concepts'),
      path.join(this.config.knowledgePath, 'syntheses'),
      this.config.graphPath
    ]

    for (const dir of dirs) {
      await fs.promises.mkdir(dir, { recursive: true })
    }
    logger.debug('Directories ensured', { dirs })
  }

  private async initGit(): Promise<void> {
    const tracker = new GitTracker(this.config.repoPath)
    await tracker.init('main')
  }

  private async createGitignore(): Promise<void> {
    const gitignorePath = path.join(this.config.repoPath, '.gitignore')
    try {
      await fs.promises.access(gitignorePath)
      return // already exists
    } catch {
      // write default .gitignore
    }

    const content = `# Note Agent internal files (not part of knowledge base)
.DS_Store
*.tmp
*.log
.snapshots/
`
    await fs.promises.writeFile(gitignorePath, content, 'utf-8')
    logger.debug('.gitignore created')
  }
}
