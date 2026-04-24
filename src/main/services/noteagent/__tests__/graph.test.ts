import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('node:fs')
vi.unmock('node:path')
vi.unmock('node:os')

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { LinkGraphAnalyzer } from '../core/graph/LinkGraphAnalyzer'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'noteagent-graph-'))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

describe('LinkGraphAnalyzer', () => {
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

  it('builds graph from interlinked pages', async () => {
    writeFile(path.join(dir, 'sources', 'a.md'), '---\ntitle: Page A\n---\n\nSee [[Page B]]\n')
    writeFile(path.join(dir, 'sources', 'b.md'), '---\ntitle: Page B\n---\n\nSee [[Page A]]\n')

    const analyzer = new LinkGraphAnalyzer(dir)
    const { nodes, stats } = await analyzer.analyze()

    expect(nodes.size).toBe(2)
    expect(stats.totalNodes).toBe(2)
    expect(stats.totalEdges).toBe(2)

    const nodeA = nodes.get('a')!
    expect(nodeA.outgoing).toContain('b')
    expect(nodeA.incoming).toContain('b')

    const nodeB = nodes.get('b')!
    expect(nodeB.outgoing).toContain('a')
    expect(nodeB.incoming).toContain('a')
  })

  it('identifies hubs', async () => {
    // Central node linked by everyone
    writeFile(path.join(dir, 'sources', 'hub.md'), '---\ntitle: Hub\n---\n\n# Hub\n')
    writeFile(path.join(dir, 'sources', 'a.md'), '---\ntitle: Page A\n---\n\nSee [[Hub]]\n')
    writeFile(path.join(dir, 'sources', 'b.md'), '---\ntitle: Page B\n---\n\nSee [[Hub]]\n')

    const analyzer = new LinkGraphAnalyzer(dir)
    const { stats } = await analyzer.analyze()

    const hub = stats.hubs.find((h) => h.id === 'hub')
    expect(hub).toBeDefined()
    expect(hub!.degree).toBe(2) // 2 incoming
  })

  it('finds separate clusters', async () => {
    // Cluster 1: a <-> b
    writeFile(path.join(dir, 'sources', 'a.md'), '---\ntitle: Page A\n---\n\nSee [[Page B]]\n')
    writeFile(path.join(dir, 'sources', 'b.md'), '---\ntitle: Page B\n---\n\nSee [[Page A]]\n')
    // Cluster 2: c <-> d
    writeFile(path.join(dir, 'sources', 'c.md'), '---\ntitle: Page C\n---\n\nSee [[Page D]]\n')
    writeFile(path.join(dir, 'sources', 'd.md'), '---\ntitle: Page D\n---\n\nSee [[Page C]]\n')

    const analyzer = new LinkGraphAnalyzer(dir)
    const { stats } = await analyzer.analyze()

    expect(stats.clusters).toHaveLength(2)
  })

  it('excludes self-links', async () => {
    writeFile(path.join(dir, 'sources', 'self.md'), '---\ntitle: Self\n---\n\nSee [[Self]]\n')

    const analyzer = new LinkGraphAnalyzer(dir)
    const { nodes } = await analyzer.analyze()

    const node = nodes.get('self')!
    expect(node.outgoing).not.toContain('self')
    expect(node.incoming).not.toContain('self')
  })

  it('matches links by slug when title differs', async () => {
    writeFile(path.join(dir, 'sources', 'slug-target.md'), '---\ntitle: The Title\n---\n\n# The Title\n')
    writeFile(path.join(dir, 'sources', 'linker.md'), '---\ntitle: Linker\n---\n\nSee [[slug-target]]\n')

    const analyzer = new LinkGraphAnalyzer(dir)
    const { nodes } = await analyzer.analyze()

    const target = nodes.get('slug-target')!
    expect(target.incoming).toContain('linker')
  })
})
