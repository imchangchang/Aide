import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('IngestScanner')

export interface FileManifestEntry {
  relativePath: string
  hash: string
  mtime: number
  size: number
}

export interface ScanResult {
  added: string[]
  modified: string[]
  unchanged: string[]
  deleted: string[]
}

const MANIFEST_FILE = '.ingest-manifest.json'
const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt'])

/**
 * Scans the raw/ directory for source files and detects changes
 * by comparing against the last ingest manifest.
 */
export class Scanner {
  private readonly rawPath: string
  private readonly manifestPath: string

  constructor(rawPath: string) {
    this.rawPath = rawPath
    this.manifestPath = path.join(rawPath, MANIFEST_FILE)
  }

  /**
   * Scan raw/ and return files categorized by change status.
   */
  async scan(): Promise<ScanResult> {
    const currentFiles = await this.collectFiles()
    const lastManifest = await this.loadManifest()

    const added: string[] = []
    const modified: string[] = []
    const unchanged: string[] = []

    for (const [relativePath, entry] of currentFiles) {
      const lastEntry = lastManifest.get(relativePath)
      if (!lastEntry) {
        added.push(relativePath)
      } else if (lastEntry.hash !== entry.hash || lastEntry.mtime !== entry.mtime) {
        modified.push(relativePath)
      } else {
        unchanged.push(relativePath)
      }
    }

    const deleted: string[] = []
    for (const relativePath of lastManifest.keys()) {
      if (!currentFiles.has(relativePath)) {
        deleted.push(relativePath)
      }
    }

    logger.info('Scan complete', {
      total: currentFiles.size,
      added: added.length,
      modified: modified.length,
      unchanged: unchanged.length,
      deleted: deleted.length
    })

    return { added, modified, unchanged, deleted }
  }

  /**
   * Save the current scan state as the new manifest.
   */
  async saveManifest(files: string[]): Promise<void> {
    const entries: FileManifestEntry[] = []
    for (const relativePath of files) {
      const fullPath = path.join(this.rawPath, relativePath)
      const stat = await fs.promises.stat(fullPath)
      const content = await fs.promises.readFile(fullPath, 'utf-8')
      entries.push({
        relativePath,
        hash: this.computeHash(content),
        mtime: stat.mtimeMs,
        size: stat.size
      })
    }

    await fs.promises.writeFile(this.manifestPath, JSON.stringify(entries, null, 2), 'utf-8')
    logger.debug('Manifest saved', { count: entries.length })
  }

  /**
   * Compute SHA256 hash of file content.
   */
  computeHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
  }

  private async collectFiles(): Promise<Map<string, FileManifestEntry>> {
    const result = new Map<string, FileManifestEntry>()
    await this.walkDir(this.rawPath, '', result)
    return result
  }

  private async walkDir(dir: string, relativeDir: string, result: Map<string, FileManifestEntry>): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue // skip hidden files/dirs

      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await this.walkDir(fullPath, relativePath, result)
      } else if (entry.isFile() && this.isSupported(fullPath)) {
        const stat = await fs.promises.stat(fullPath)
        const content = await fs.promises.readFile(fullPath, 'utf-8')
        result.set(relativePath, {
          relativePath,
          hash: this.computeHash(content),
          mtime: stat.mtimeMs,
          size: stat.size
        })
      }
    }
  }

  private isSupported(filePath: string): boolean {
    return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  }

  private async loadManifest(): Promise<Map<string, FileManifestEntry>> {
    try {
      const content = await fs.promises.readFile(this.manifestPath, 'utf-8')
      const entries: FileManifestEntry[] = JSON.parse(content)
      const map = new Map<string, FileManifestEntry>()
      for (const entry of entries) {
        map.set(entry.relativePath, entry)
      }
      return map
    } catch {
      return new Map()
    }
  }
}
