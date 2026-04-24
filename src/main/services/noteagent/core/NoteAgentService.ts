import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { getNotesDir } from '@main/utils/file'

import { GitTracker } from './GitTracker'
import { LinkGraphAnalyzer } from './graph/LinkGraphAnalyzer'
import type { HealthReport } from './health/HealthChecker'
import { HealthChecker } from './health/HealthChecker'
import { FrontmatterParser } from './ingest/FrontmatterParser'
import type { IngestResult } from './ingest/IngestOrchestrator'
import { IngestOrchestrator } from './ingest/IngestOrchestrator'
import type { WorkspaceConfig } from './WorkspaceInitializer'
import { WorkspaceInitializer } from './WorkspaceInitializer'

const logger = loggerService.withContext('NoteAgentService')

export interface QueryResult {
  pages: {
    title: string
    relativePath: string
    excerpt: string
  }[]
}

export interface NoteAgentStatus {
  initialized: boolean
  workspacePath?: string
  hasCommits: boolean
  recentCommits: { oid: string; message: string; date: string }[]
}

/**
 * High-level service that orchestrates all Note Agent capabilities.
 *
 * Integrates:
 * - Workspace initialization
 * - Ingest pipeline (raw → knowledge)
 * - Health checks
 * - Link graph analysis
 * - Local keyword search
 * - Git change tracking
 */
export class NoteAgentService {
  private workspacePath?: string
  private rawPath?: string
  private knowledgePath?: string
  private workspaceInitializer?: WorkspaceInitializer
  private gitTracker?: GitTracker
  private ingestOrchestrator?: IngestOrchestrator
  private healthChecker?: HealthChecker
  private linkGraphAnalyzer?: LinkGraphAnalyzer
  private parser = new FrontmatterParser()

  /**
   * Initialize the service with Note's default notes directory.
   * Uses getNotesDir() as workspace, so raw/notes aligns with Note storage.
   */
  async initWithNotesDir(): Promise<WorkspaceConfig> {
    const notesDir = getNotesDir()
    return this.init(notesDir)
  }

  /**
   * Initialize the service with a workspace directory.
   * Creates directory structure and git repo if missing.
   */
  async init(workspacePath: string): Promise<WorkspaceConfig> {
    this.workspacePath = workspacePath
    this.rawPath = path.join(workspacePath, 'raw')
    this.knowledgePath = path.join(workspacePath, 'knowledge')

    this.workspaceInitializer = new WorkspaceInitializer(workspacePath)
    const config = await this.workspaceInitializer.init()

    this.gitTracker = new GitTracker(workspacePath)
    await this.gitTracker.init()

    this.ingestOrchestrator = new IngestOrchestrator(this.rawPath, this.knowledgePath)
    this.healthChecker = new HealthChecker(this.knowledgePath)
    this.linkGraphAnalyzer = new LinkGraphAnalyzer(this.knowledgePath)

    logger.info('NoteAgentService initialized', { workspacePath })
    return config
  }

  /**
   * Run a full ingest cycle: scan raw/ → parse → build source pages → index → git commit.
   */
  async ingest(): Promise<IngestResult> {
    this.ensureInitialized()
    return this.ingestOrchestrator!.ingest()
  }

  /**
   * Check knowledge base health.
   */
  async healthCheck(): Promise<HealthReport> {
    this.ensureInitialized()
    return this.healthChecker!.check()
  }

  /**
   * Analyze the knowledge base link graph.
   */
  async analyzeGraph(): Promise<ReturnType<LinkGraphAnalyzer['analyze']>> {
    this.ensureInitialized()
    return this.linkGraphAnalyzer!.analyze()
  }

  /**
   * Search knowledge pages by keyword (title + body).
   */
  async query(keyword: string): Promise<QueryResult> {
    this.ensureInitialized()
    const results: QueryResult['pages'] = []
    const lowerKeyword = keyword.toLowerCase()
    const categories = ['sources', 'entities', 'concepts', 'syntheses']

    for (const category of categories) {
      const dirPath = path.join(this.knowledgePath!, category)
      let files: string[]
      try {
        const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })
        files = dirents.filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name)
      } catch {
        continue
      }

      for (const filename of files) {
        const filePath = path.join(dirPath, filename)
        const content = await fs.promises.readFile(filePath, 'utf-8')
        const parsed = this.parser.parse(content)
        const title = (parsed.frontmatter.title as string) || filename.replace(/\.md$/, '')
        const bodyLower = parsed.body.toLowerCase()

        if (title.toLowerCase().includes(lowerKeyword) || bodyLower.includes(lowerKeyword)) {
          const excerpt = this.makeExcerpt(parsed.body, lowerKeyword)
          results.push({
            title,
            relativePath: path.join(category, filename),
            excerpt
          })
        }
      }
    }

    logger.info('Query executed', { keyword, results: results.length })
    return { pages: results }
  }

  /**
   * Get current service status including git history.
   */
  async status(): Promise<NoteAgentStatus> {
    if (!this.workspacePath || !this.gitTracker) {
      return { initialized: false, hasCommits: false, recentCommits: [] }
    }

    const hasCommits = await this.gitTracker.hasCommits()
    let recentCommits: NoteAgentStatus['recentCommits'] = []
    if (hasCommits) {
      const logs = await this.gitTracker.log({ depth: 5 })
      recentCommits = logs.map((c) => ({
        oid: c.oid.slice(0, 7),
        message: c.message,
        date: new Date(c.author.timestamp * 1000).toISOString()
      }))
    }

    return {
      initialized: true,
      workspacePath: this.workspacePath,
      hasCommits,
      recentCommits
    }
  }

  /**
   * Rebuild the knowledge index manually.
   */
  async rebuildIndex(): Promise<void> {
    this.ensureInitialized()
    const { IndexUpdater } = await import('./ingest/IndexUpdater')
    const updater = new IndexUpdater(this.knowledgePath!)
    await updater.rebuildIndex()
    logger.info('Index rebuilt manually')
  }

  private ensureInitialized(): void {
    if (!this.workspacePath || !this.ingestOrchestrator) {
      throw new Error('NoteAgentService not initialized. Call init() first.')
    }
  }

  private makeExcerpt(body: string, keyword: string): string {
    const idx = body.toLowerCase().indexOf(keyword)
    if (idx === -1) return body.slice(0, 120).replace(/\s+/g, ' ').trim() + '...'

    const start = Math.max(0, idx - 40)
    const end = Math.min(body.length, idx + keyword.length + 40)
    let excerpt = body.slice(start, end).replace(/\s+/g, ' ').trim()
    if (start > 0) excerpt = '...' + excerpt
    if (end < body.length) excerpt = excerpt + '...'
    return excerpt
  }
}

let globalNoteAgentService: NoteAgentService | null = null

export function getNoteAgentService(): NoteAgentService {
  if (!globalNoteAgentService) {
    globalNoteAgentService = new NoteAgentService()
  }
  return globalNoteAgentService
}
