import { loggerService } from '@logger'

const logger = loggerService.withContext('FrontmatterParser')

export interface ParsedFrontmatter {
  title?: string
  type?: string
  tags?: string[] | string
  date?: string
  [key: string]: unknown
}

export interface ParseResult {
  frontmatter: ParsedFrontmatter
  body: string
  raw: string
}

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Expected format:
 * ---
 * title: "Page Title"
 * tags: [tag1, tag2]
 * ---
 * <body content>
 */
export class FrontmatterParser {
  /**
   * Parse frontmatter and body from markdown text.
   */
  parse(content: string): ParseResult {
    const trimmed = content.trimStart()

    if (!trimmed.startsWith('---')) {
      return {
        frontmatter: {},
        body: content,
        raw: content
      }
    }

    const endIndex = trimmed.indexOf('---', 3)
    if (endIndex === -1) {
      logger.warn('Malformed frontmatter: opening --- without closing ---')
      return {
        frontmatter: {},
        body: content,
        raw: content
      }
    }

    const frontmatterRaw = trimmed.slice(3, endIndex).trim()
    const body = trimmed.slice(endIndex + 3).trimStart()

    const frontmatter = this.parseYaml(frontmatterRaw)

    return {
      frontmatter,
      body,
      raw: content
    }
  }

  /**
   * Serialize frontmatter and body back to markdown text.
   */
  serialize(frontmatter: ParsedFrontmatter, body: string): string {
    const yaml = this.toYaml(frontmatter)
    if (!yaml) {
      return body
    }
    return `---\n${yaml}---\n\n${body}`
  }

  private parseYaml(raw: string): ParsedFrontmatter {
    const result: ParsedFrontmatter = {}
    const lines = raw.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) continue

      const key = trimmed.slice(0, colonIndex).trim()
      let value = trimmed.slice(colonIndex + 1).trim()

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      // Parse arrays: [a, b, c]
      if (value.startsWith('[') && value.endsWith(']')) {
        const items = value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => {
            // Remove quotes from array items
            if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
              return s.slice(1, -1)
            }
            return s
          })
        result[key] = items
      } else {
        result[key] = value
      }
    }

    return result
  }

  private toYaml(frontmatter: ParsedFrontmatter): string {
    const lines: string[] = []
    for (const [key, value] of Object.entries(frontmatter)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        lines.push(`${key}: [${value.map((v) => `"${v}"`).join(', ')}]`)
      } else {
        lines.push(`${key}: "${String(value)}"`)
      }
    }
    return lines.length > 0 ? lines.join('\n') + '\n' : ''
  }
}
