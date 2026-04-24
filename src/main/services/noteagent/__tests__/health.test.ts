import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('node:fs')
vi.unmock('node:path')
vi.unmock('node:os')

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { HealthChecker } from '../core/health/HealthChecker'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'noteagent-health-'))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

describe('HealthChecker', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    for (const cat of ['sources', 'entities', 'concepts', 'syntheses']) {
      fs.mkdirSync(path.join(dir, cat), { recursive: true })
    }
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reports no issues for a healthy knowledge base', async () => {
    // Populate all categories to avoid empty-category issues
    writeFile(path.join(dir, 'sources', 'a.md'), '---\ntitle: Page A\n---\n\nSee [[Page B]] and [[Synthesis D]]\n')
    writeFile(path.join(dir, 'entities', 'b.md'), '---\ntitle: Page B\n---\n\nSee [[Page A]]\n')
    writeFile(path.join(dir, 'concepts', 'c.md'), '---\ntitle: Concept C\n---\n\nSee [[Page A]]\n')
    writeFile(path.join(dir, 'syntheses', 'd.md'), '---\ntitle: Synthesis D\n---\n\nSee [[Concept C]]\n')

    const checker = new HealthChecker(dir)
    const report = await checker.check()

    expect(report.issues).toHaveLength(0)
    expect(report.summary.orphans).toBe(0)
    expect(report.summary.brokenLinks).toBe(0)
    expect(report.summary.emptyCategories).toBe(0)
  })

  it('detects orphan pages', async () => {
    writeFile(path.join(dir, 'sources', 'lonely.md'), '---\ntitle: Lonely\n---\n\n# Lonely\n')
    writeFile(path.join(dir, 'sources', 'popular.md'), '---\ntitle: Popular\n---\n\nI am linked.\n')

    const checker = new HealthChecker(dir)
    const report = await checker.check()

    const orphan = report.issues.find((i) => i.type === 'orphan')
    expect(orphan).toBeDefined()
    expect(orphan?.page).toContain('lonely.md')
  })

  it('detects broken links', async () => {
    writeFile(path.join(dir, 'sources', 'bad-link.md'), '---\ntitle: Bad Link\n---\n\nSee [[NonExistent]]\n')

    const checker = new HealthChecker(dir)
    const report = await checker.check()

    const broken = report.issues.find((i) => i.type === 'broken-link')
    expect(broken).toBeDefined()
    expect(broken?.details).toContain('NonExistent')
  })

  it('detects empty categories', async () => {
    // Only sources has a file; entities/concepts/syntheses are empty
    writeFile(path.join(dir, 'sources', 'only.md'), '# Only\n')

    const checker = new HealthChecker(dir)
    const report = await checker.check()

    const empty = report.issues.filter((i) => i.type === 'empty-category')
    expect(empty.length).toBeGreaterThanOrEqual(2)
    expect(empty.map((i) => i.page)).toContain('entities')
  })

  it('matches links by title or slug', async () => {
    writeFile(path.join(dir, 'sources', 'slug-target.md'), '---\ntitle: The Title\n---\n\n# The Title\n')
    writeFile(
      path.join(dir, 'sources', 'linker.md'),
      '---\ntitle: Linker\n---\n\nSee [[The Title]] and [[slug-target]]\n'
    )

    const checker = new HealthChecker(dir)
    const report = await checker.check()

    expect(report.summary.brokenLinks).toBe(0)
  })
})
