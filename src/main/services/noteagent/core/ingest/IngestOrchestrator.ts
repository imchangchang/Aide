import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'

import { GitTracker } from '../GitTracker'
import type { ParseResult } from './FrontmatterParser'
import { FrontmatterParser } from './FrontmatterParser'
import { IndexUpdater } from './IndexUpdater'
import { LinkExtractor } from './LinkExtractor'
import { Scanner } from './Scanner'

const logger = loggerService.withContext('IngestOrchestrator')

export interface SourcePage {
  slug: string
  title: string
  type: 'source'
  tags: string[]
  body: string
  rawPath: string
}

export interface IngestResult {
  processed: string[]
  errors: { path: string; error: string }[]
  summary: {
    added: number
    modified: number
    unchanged: number
    deleted: number
  }
}

/**
 * Orchestrate the full ingest pipeline:
 * 1. Scan raw/ for changes
 * 2. Parse frontmatter and extract links/tags
 * 3. Write source pages to knowledge/sources/
 * 4. Update knowledge/index.md
 * 5. Git commit
 */
export class IngestOrchestrator {
  private readonly rawPath: string
  private readonly knowledgePath: string
  private readonly scanner: Scanner
  private readonly parser: FrontmatterParser
  private readonly linkExtractor: LinkExtractor
  private readonly indexUpdater: IndexUpdater
  private readonly git: GitTracker

  constructor(rawPath: string, knowledgePath: string) {
    this.rawPath = rawPath
    this.knowledgePath = knowledgePath
    this.scanner = new Scanner(rawPath)
    this.parser = new FrontmatterParser()
    this.linkExtractor = new LinkExtractor()
    this.indexUpdater = new IndexUpdater(knowledgePath)
    this.git = new GitTracker(path.dirname(rawPath))
  }

  /**
   * Run a full ingest cycle.
   */
  async ingest(): Promise<IngestResult> {
    await this.git.init()

    const scan = await this.scanner.scan()
    const processed: string[] = []
    const errors: { path: string; error: string }[] = []

    // Process added and modified files
    const toProcess = [...scan.added, ...scan.modified]
    for (const relativePath of toProcess) {
      try {
        await this.processFile(relativePath)
        processed.push(relativePath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('Failed to process file', { path: relativePath, error: msg })
        errors.push({ path: relativePath, error: msg })
      }
    }

    // Handle deletions: remove corresponding source pages
    for (const relativePath of scan.deleted) {
      try {
        await this.deleteSourcePage(relativePath)
        processed.push(relativePath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('Failed to delete source page', { path: relativePath, error: msg })
        errors.push({ path: relativePath, error: msg })
      }
    }

    // Update index if anything changed
    if (toProcess.length > 0 || scan.deleted.length > 0) {
      await this.indexUpdater.rebuildIndex()
    }

    // Save manifest for next scan
    const currentFiles = [...scan.added, ...scan.modified, ...scan.unchanged]
    await this.scanner.saveManifest(currentFiles)

    // Git commit if there are changes
    const hasChanges = processed.length > 0
    if (hasChanges) {
      const commitMsg = this.buildCommitMessage(scan, errors)
      try {
        await this.git.stageAndCommit(commitMsg)
      } catch (err) {
        logger.warn('Git commit failed, continuing', { error: String(err) })
      }
    }

    logger.info('Ingest complete', {
      processed: processed.length,
      errors: errors.length,
      added: scan.added.length,
      modified: scan.modified.length,
      deleted: scan.deleted.length
    })

    return {
      processed,
      errors,
      summary: {
        added: scan.added.length,
        modified: scan.modified.length,
        unchanged: scan.unchanged.length,
        deleted: scan.deleted.length
      }
    }
  }

  private async processFile(relativePath: string): Promise<void> {
    const fullPath = path.join(this.rawPath, relativePath)
    const content = await fs.promises.readFile(fullPath, 'utf-8')
    const parsed = this.parser.parse(content)

    const slug = this.slugify(path.basename(relativePath, path.extname(relativePath)))
    const title = parsed.frontmatter.title || slug
    const tags = this.extractTags(parsed)

    // Build source page with metadata + original body
    const sourceBody = this.renderSourcePage({
      slug,
      title,
      type: 'source',
      tags,
      body: parsed.body,
      rawPath: relativePath
    })

    const sourcePath = path.join(this.knowledgePath, 'sources', `${slug}.md`)
    await fs.promises.mkdir(path.dirname(sourcePath), { recursive: true })
    await fs.promises.writeFile(sourcePath, sourceBody, 'utf-8')

    logger.debug('Source page written', { slug, path: relativePath })
  }

  private async deleteSourcePage(relativePath: string): Promise<void> {
    const slug = this.slugify(path.basename(relativePath, path.extname(relativePath)))
    const sourcePath = path.join(this.knowledgePath, 'sources', `${slug}.md`)
    try {
      await fs.promises.unlink(sourcePath)
      logger.debug('Source page deleted', { slug })
    } catch {
      // File may not exist, ignore
    }
  }

  private renderSourcePage(page: SourcePage): string {
    const lines: string[] = ['---', `title: "${page.title}"`, `type: "source"`, `raw_path: "${page.rawPath}"`]

    if (page.tags.length > 0) {
      lines.push(`tags: [${page.tags.map((t) => `"${t}"`).join(', ')}]`)
    }

    lines.push('---', '')
    lines.push(`# ${page.title}`, '')
    lines.push('## Content', '')
    lines.push(page.body)
    lines.push('')

    return lines.join('\n')
  }

  private extractTags(parsed: ParseResult): string[] {
    const fmTags = parsed.frontmatter.tags
    if (Array.isArray(fmTags)) {
      return fmTags.filter((t): t is string => typeof t === 'string')
    } else if (typeof fmTags === 'string') {
      return fmTags.split(',').map((t) => t.trim())
    }
    return this.linkExtractor.extract(parsed.body).tags
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 64)
  }

  private buildCommitMessage(
    scan: {
      added: string[]
      modified: string[]
      deleted: string[]
    },
    errors: { path: string }[]
  ): string {
    const parts: string[] = ['ingest:']
    if (scan.added.length > 0) parts.push(`add ${scan.added.length}`)
    if (scan.modified.length > 0) parts.push(`mod ${scan.modified.length}`)
    if (scan.deleted.length > 0) parts.push(`del ${scan.deleted.length}`)
    if (errors.length > 0) parts.push(`err ${errors.length}`)
    return parts.join(' ') || 'ingest: no changes'
  }
}
