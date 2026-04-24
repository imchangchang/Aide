import { loggerService } from '@logger'

const logger = loggerService.withContext('LinkExtractor')

export interface LinkAnalysis {
  wikiLinks: string[] // [[PageName]] -> PageName
  tags: string[] // #tag
  backlinks: Map<string, Set<string>> // targetPage -> Set<sourcePages>
}

/**
 * Extract wiki links and tags from markdown content.
 * Build backlink index across all pages.
 */
export class LinkExtractor {
  /**
   * Extract wiki links and tags from a single document.
   */
  extract(content: string): { wikiLinks: string[]; tags: string[] } {
    const wikiLinks = this.extractWikiLinks(content)
    const tags = this.extractTags(content)
    return { wikiLinks, tags }
  }

  /**
   * Build backlink map: for each target page, which pages link to it.
   */
  buildBacklinks(pages: Map<string, { wikiLinks: string[] }>): Map<string, Set<string>> {
    const backlinks = new Map<string, Set<string>>()

    for (const [sourcePath, { wikiLinks }] of pages) {
      for (const target of wikiLinks) {
        const normalizedTarget = this.normalizePageName(target)
        if (!backlinks.has(normalizedTarget)) {
          backlinks.set(normalizedTarget, new Set())
        }
        backlinks.get(normalizedTarget)!.add(sourcePath)
      }
    }

    logger.debug('Backlinks built', { pages: pages.size, uniqueTargets: backlinks.size })
    return backlinks
  }

  private extractWikiLinks(content: string): string[] {
    const links = new Set<string>()
    // Match [[PageName]] or [[PageName|Display Text]]
    const regex = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const pageName = match[1].trim()
      if (pageName) {
        links.add(this.normalizePageName(pageName))
      }
    }
    return Array.from(links)
  }

  private extractTags(content: string): string[] {
    const tags = new Set<string>()
    // Match #tag but not inside code blocks or URLs
    const lines = content.split('\n')
    let inCodeBlock = false
    for (const line of lines) {
      const trimmed = line.trimStart()
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }
      if (inCodeBlock) continue
      // Match #tag (alphanumeric + hyphens + underscores)
      const regex = /#([a-zA-Z0-9_\-一-龥]+)/g
      let match: RegExpExecArray | null
      while ((match = regex.exec(line)) !== null) {
        tags.add(match[1])
      }
    }
    return Array.from(tags)
  }

  private normalizePageName(name: string): string {
    // Obsidian convention: wiki link targets are case-insensitive
    // We normalize to preserve original casing but use consistent lookups
    return name.trim()
  }
}
