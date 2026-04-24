import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('IndexUpdater')

export interface IndexEntry {
  slug: string
  title: string
  type: 'source' | 'entity' | 'concept' | 'synthesis'
  description?: string
}

/**
 * Maintain the knowledge/index.md directory file.
 */
export class IndexUpdater {
  private readonly knowledgePath: string
  private readonly indexPath: string

  constructor(knowledgePath: string) {
    this.knowledgePath = knowledgePath
    this.indexPath = path.join(knowledgePath, 'index.md')
  }

  /**
   * Rebuild index.md from all pages in knowledge/.
   */
  async rebuildIndex(): Promise<void> {
    const entries = await this.collectEntries()
    const content = this.renderIndex(entries)
    await fs.promises.writeFile(this.indexPath, content, 'utf-8')
    logger.info('Index rebuilt', {
      sources: entries.sources.length,
      entities: entries.entities.length,
      concepts: entries.concepts.length,
      syntheses: entries.syntheses.length
    })
  }

  /**
   * Read current index entries.
   */
  async readIndex(): Promise<IndexEntry[]> {
    try {
      const content = await fs.promises.readFile(this.indexPath, 'utf-8')
      return this.parseIndex(content)
    } catch {
      return []
    }
  }

  private async collectEntries(): Promise<{
    sources: IndexEntry[]
    entities: IndexEntry[]
    concepts: IndexEntry[]
    syntheses: IndexEntry[]
  }> {
    const result = {
      sources: [] as IndexEntry[],
      entities: [] as IndexEntry[],
      concepts: [] as IndexEntry[],
      syntheses: [] as IndexEntry[]
    }

    const dirs: { path: string; type: IndexEntry['type'] }[] = [
      { path: path.join(this.knowledgePath, 'sources'), type: 'source' },
      { path: path.join(this.knowledgePath, 'entities'), type: 'entity' },
      { path: path.join(this.knowledgePath, 'concepts'), type: 'concept' },
      { path: path.join(this.knowledgePath, 'syntheses'), type: 'synthesis' }
    ]

    for (const { path: dirPath, type } of dirs) {
      let files: string[]
      try {
        const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })
        files = dirents.filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name)
      } catch {
        continue
      }

      for (const filename of files) {
        const slug = filename.replace(/\.md$/, '')
        const filePath = path.join(dirPath, filename)
        const title = await this.extractTitle(filePath, slug)
        const list = this.getListForType(result, type)
        list.push({ slug, title, type })
      }
    }

    // Sort each category alphabetically
    result.sources.sort((a, b) => a.title.localeCompare(b.title))
    result.entities.sort((a, b) => a.title.localeCompare(b.title))
    result.concepts.sort((a, b) => a.title.localeCompare(b.title))
    result.syntheses.sort((a, b) => a.title.localeCompare(b.title))

    return result
  }

  private async extractTitle(filePath: string, fallback: string): Promise<string> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      // Try frontmatter title first
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
      if (fmMatch) {
        const titleMatch = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)
        if (titleMatch) {
          return titleMatch[1].trim()
        }
      }
      // Try first H1
      const h1Match = content.match(/^#\s+(.+)$/m)
      if (h1Match) {
        return h1Match[1].trim()
      }
    } catch {
      // ignore
    }
    return fallback
  }

  private renderIndex(entries: {
    sources: IndexEntry[]
    entities: IndexEntry[]
    concepts: IndexEntry[]
    syntheses: IndexEntry[]
  }): string {
    const lines: string[] = ['# Knowledge Index\n']

    if (entries.sources.length > 0) {
      lines.push('## Sources')
      for (const entry of entries.sources) {
        lines.push(`- [[${entry.title}]] — ${entry.slug}`)
      }
      lines.push('')
    }

    if (entries.entities.length > 0) {
      lines.push('## Entities')
      for (const entry of entries.entities) {
        lines.push(`- [[${entry.title}]]`)
      }
      lines.push('')
    }

    if (entries.concepts.length > 0) {
      lines.push('## Concepts')
      for (const entry of entries.concepts) {
        lines.push(`- [[${entry.title}]]`)
      }
      lines.push('')
    }

    if (entries.syntheses.length > 0) {
      lines.push('## Syntheses')
      for (const entry of entries.syntheses) {
        lines.push(`- [[${entry.title}]]`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  private getListForType(
    result: {
      sources: IndexEntry[]
      entities: IndexEntry[]
      concepts: IndexEntry[]
      syntheses: IndexEntry[]
    },
    type: IndexEntry['type']
  ): IndexEntry[] {
    switch (type) {
      case 'source':
        return result.sources
      case 'entity':
        return result.entities
      case 'concept':
        return result.concepts
      case 'synthesis':
        return result.syntheses
    }
  }

  private parseIndex(content: string): IndexEntry[] {
    const entries: IndexEntry[] = []
    const lines = content.split('\n')
    let currentType: IndexEntry['type'] = 'source'

    const sectionToType: Record<string, IndexEntry['type']> = {
      Sources: 'source',
      Entities: 'entity',
      Concepts: 'concept',
      Syntheses: 'synthesis'
    }

    for (const line of lines) {
      const sectionMatch = line.match(/^##\s+(Sources|Entities|Concepts|Syntheses)$/)
      if (sectionMatch) {
        currentType = sectionToType[sectionMatch[1]]
        continue
      }

      const entryMatch = line.match(/^-\s+\[\[([^\]]+)\]\](?:\s*—\s*(.+))?$/)
      if (entryMatch) {
        entries.push({
          slug: entryMatch[2]?.trim() || entryMatch[1].trim(),
          title: entryMatch[1].trim(),
          type: currentType
        })
      }
    }

    return entries
  }
}
