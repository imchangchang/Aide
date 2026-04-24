import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'

import { FrontmatterParser } from '../ingest/FrontmatterParser'
import { LinkExtractor } from '../ingest/LinkExtractor'

const logger = loggerService.withContext('HealthChecker')

export interface HealthIssue {
  type: 'orphan' | 'broken-link' | 'empty-category'
  page: string
  details: string
}

export interface HealthReport {
  issues: HealthIssue[]
  summary: {
    orphans: number
    brokenLinks: number
    emptyCategories: number
  }
}

interface PageInfo {
  slug: string
  title: string
  relativePath: string
  wikiLinks: string[]
}

/**
 * Check knowledge base health:
 * - Orphan pages: no backlinks (except index.md)
 * - Broken links: wiki links pointing to non-existent pages
 * - Empty categories: no pages in a category directory
 */
export class HealthChecker {
  private readonly knowledgePath: string
  private readonly parser: FrontmatterParser
  private readonly linkExtractor: LinkExtractor

  constructor(knowledgePath: string) {
    this.knowledgePath = knowledgePath
    this.parser = new FrontmatterParser()
    this.linkExtractor = new LinkExtractor()
  }

  /**
   * Run all health checks and return a report.
   */
  async check(): Promise<HealthReport> {
    const pages = await this.collectPages()
    const knownPages = this.buildKnownPages(pages)
    const backlinks = this.linkExtractor.buildBacklinks(
      new Map(pages.map((p) => [p.relativePath, { wikiLinks: p.wikiLinks }]))
    )

    const issues: HealthIssue[] = [
      ...this.findOrphans(pages, backlinks),
      ...this.findBrokenLinks(pages, knownPages),
      ...(await this.findEmptyCategories())
    ]

    const report = {
      issues,
      summary: {
        orphans: issues.filter((i) => i.type === 'orphan').length,
        brokenLinks: issues.filter((i) => i.type === 'broken-link').length,
        emptyCategories: issues.filter((i) => i.type === 'empty-category').length
      }
    }

    logger.info('Health check complete', report.summary)
    return report
  }

  private async collectPages(): Promise<PageInfo[]> {
    const pages: PageInfo[] = []
    const categories = ['sources', 'entities', 'concepts', 'syntheses']

    for (const category of categories) {
      const dirPath = path.join(this.knowledgePath, category)
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
        const slug = filename.replace(/\.md$/, '')
        const title = parsed.frontmatter.title || slug
        const { wikiLinks } = this.linkExtractor.extract(parsed.body)

        pages.push({
          slug,
          title,
          relativePath: path.join(category, filename),
          wikiLinks
        })
      }
    }

    return pages
  }

  private buildKnownPages(pages: PageInfo[]): Set<string> {
    const known = new Set<string>()
    for (const page of pages) {
      known.add(page.slug.toLowerCase())
      known.add(page.title.toLowerCase())
    }
    return known
  }

  private findOrphans(pages: PageInfo[], backlinks: Map<string, Set<string>>): HealthIssue[] {
    const issues: HealthIssue[] = []

    for (const page of pages) {
      // Skip index.md
      if (page.slug === 'index') continue

      const hasBacklink = backlinks.has(page.slug) || backlinks.has(page.title)

      if (!hasBacklink) {
        issues.push({
          type: 'orphan',
          page: page.relativePath,
          details: `No pages link to "${page.title}"`
        })
      }
    }

    logger.debug('Orphan check', { count: issues.length })
    return issues
  }

  private findBrokenLinks(pages: PageInfo[], knownPages: Set<string>): HealthIssue[] {
    const issues: HealthIssue[] = []

    for (const page of pages) {
      for (const link of page.wikiLinks) {
        if (!knownPages.has(link.toLowerCase())) {
          issues.push({
            type: 'broken-link',
            page: page.relativePath,
            details: `Link to "${link}" points to a non-existent page`
          })
        }
      }
    }

    logger.debug('Broken link check', { count: issues.length })
    return issues
  }

  private async findEmptyCategories(): Promise<HealthIssue[]> {
    const issues: HealthIssue[] = []
    const categories = ['sources', 'entities', 'concepts', 'syntheses']

    for (const category of categories) {
      const dirPath = path.join(this.knowledgePath, category)
      let hasFiles = false
      try {
        const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })
        hasFiles = dirents.some((d) => d.isFile() && d.name.endsWith('.md'))
      } catch {
        // Directory doesn't exist — treat as empty
      }

      if (!hasFiles) {
        issues.push({
          type: 'empty-category',
          page: category,
          details: `Category "${category}" has no pages`
        })
      }
    }

    logger.debug('Empty category check', { count: issues.length })
    return issues
  }
}
