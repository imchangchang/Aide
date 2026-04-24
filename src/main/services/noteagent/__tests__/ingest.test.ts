import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('node:fs')
vi.unmock('node:path')
vi.unmock('node:os')

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { FrontmatterParser } from '../core/ingest/FrontmatterParser'
import { IndexUpdater } from '../core/ingest/IndexUpdater'
import { IngestOrchestrator } from '../core/ingest/IngestOrchestrator'
import { LinkExtractor } from '../core/ingest/LinkExtractor'
import { Scanner } from '../core/ingest/Scanner'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'noteagent-ingest-'))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

describe('FrontmatterParser', () => {
  const parser = new FrontmatterParser()

  it('parses frontmatter and body', () => {
    const raw = '---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n'
    const result = parser.parse(raw)
    expect(result.frontmatter.title).toBe('Hello')
    expect(result.frontmatter.tags).toEqual(['a', 'b'])
    expect(result.body).toBe('# Body\n')
  })

  it('returns empty frontmatter when none present', () => {
    const raw = '# Just a heading\n'
    const result = parser.parse(raw)
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('# Just a heading\n')
  })

  it('serializes back to markdown', () => {
    const md = parser.serialize({ title: 'T', tags: ['x'] }, '# Body')
    expect(md).toContain('---')
    expect(md).toContain('title: "T"')
    expect(md).toContain('tags: ["x"]')
    expect(md).toContain('# Body')
  })
})

describe('LinkExtractor', () => {
  const extractor = new LinkExtractor()

  it('extracts wiki links', () => {
    const result = extractor.extract('See [[PageA]] and [[PageB|B]]')
    expect(result.wikiLinks).toContain('PageA')
    expect(result.wikiLinks).toContain('PageB')
  })

  it('extracts tags', () => {
    const result = extractor.extract('#hello #world')
    expect(result.tags).toContain('hello')
    expect(result.tags).toContain('world')
  })

  it('skips tags inside code blocks', () => {
    const result = extractor.extract('```\n#notag\n```\n#yes')
    expect(result.tags).toContain('yes')
    expect(result.tags).not.toContain('notag')
  })

  it('builds backlink map', () => {
    const pages = new Map([
      ['a.md', { wikiLinks: ['B'] }],
      ['c.md', { wikiLinks: ['B', 'D'] }]
    ])
    const backlinks = extractor.buildBacklinks(pages)
    expect(backlinks.get('B')).toEqual(new Set(['a.md', 'c.md']))
    expect(backlinks.get('D')).toEqual(new Set(['c.md']))
  })
})

describe('Scanner', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('detects added files', async () => {
    writeFile(path.join(dir, 'a.md'), 'hello')
    const scanner = new Scanner(dir)
    const result = await scanner.scan()
    expect(result.added).toContain('a.md')
    expect(result.modified).toHaveLength(0)
    expect(result.unchanged).toHaveLength(0)
  })

  it('detects modified files', async () => {
    writeFile(path.join(dir, 'a.md'), 'hello')
    const scanner = new Scanner(dir)
    await scanner.scan()
    await scanner.saveManifest(['a.md'])

    // Modify
    writeFile(path.join(dir, 'a.md'), 'hello world')
    const result2 = await scanner.scan()
    expect(result2.modified).toContain('a.md')
  })

  it('detects unchanged files', async () => {
    writeFile(path.join(dir, 'a.md'), 'hello')
    const scanner = new Scanner(dir)
    await scanner.scan()
    await scanner.saveManifest(['a.md'])

    const result2 = await scanner.scan()
    expect(result2.unchanged).toContain('a.md')
  })

  it('detects deleted files', async () => {
    writeFile(path.join(dir, 'a.md'), 'hello')
    const scanner = new Scanner(dir)
    await scanner.scan()
    await scanner.saveManifest(['a.md'])

    fs.unlinkSync(path.join(dir, 'a.md'))
    const result2 = await scanner.scan()
    expect(result2.deleted).toContain('a.md')
  })
})

describe('IndexUpdater', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    fs.mkdirSync(path.join(dir, 'sources'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'entities'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('builds index from pages', async () => {
    writeFile(path.join(dir, 'sources', 'foo.md'), '---\ntitle: Foo Title\n---\n\n# Ignored\n')
    writeFile(path.join(dir, 'entities', 'bar.md'), '# Bar Title\n')

    const updater = new IndexUpdater(dir)
    await updater.rebuildIndex()

    const indexContent = fs.readFileSync(path.join(dir, 'index.md'), 'utf-8')
    expect(indexContent).toContain('## Sources')
    expect(indexContent).toContain('[[Foo Title]]')
    expect(indexContent).toContain('## Entities')
    expect(indexContent).toContain('[[Bar Title]]')
  })

  it('reads index entries', async () => {
    writeFile(
      path.join(dir, 'index.md'),
      '# Knowledge Index\n\n## Sources\n- [[Foo]] — foo\n\n## Entities\n- [[Bar]]\n'
    )

    const updater = new IndexUpdater(dir)
    const entries = await updater.readIndex()
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.type === 'source')?.title).toBe('Foo')
    expect(entries.find((e) => e.type === 'entity')?.title).toBe('Bar')
  })
})

describe('IngestOrchestrator', () => {
  let workspace: string
  let rawPath: string
  let knowledgePath: string

  beforeEach(() => {
    workspace = tmpDir()
    rawPath = path.join(workspace, 'raw')
    knowledgePath = path.join(workspace, 'knowledge')
    fs.mkdirSync(rawPath, { recursive: true })
    fs.mkdirSync(knowledgePath, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('ingests a new file and creates source page', async () => {
    writeFile(path.join(rawPath, 'note.md'), '---\ntitle: My Note\ntags: [idea]\n---\n\n# Heading\n\nSome content.\n')

    const orchestrator = new IngestOrchestrator(rawPath, knowledgePath)
    const result = await orchestrator.ingest()

    expect(result.processed).toContain('note.md')
    expect(result.summary.added).toBe(1)

    const sourcePage = fs.readFileSync(path.join(knowledgePath, 'sources', 'note.md'), 'utf-8')
    expect(sourcePage).toContain('title: "My Note"')
    expect(sourcePage).toContain('type: "source"')
    expect(sourcePage).toContain('tags: ["idea"]')
    expect(sourcePage).toContain('# My Note')
    expect(sourcePage).toContain('Some content.')

    const indexContent = fs.readFileSync(path.join(knowledgePath, 'index.md'), 'utf-8')
    expect(indexContent).toContain('[[My Note]]')
  })

  it('handles file deletion', async () => {
    writeFile(path.join(rawPath, 'old.md'), '# Old\n')
    const orchestrator = new IngestOrchestrator(rawPath, knowledgePath)
    await orchestrator.ingest()

    // Remove file
    fs.unlinkSync(path.join(rawPath, 'old.md'))
    const result = await orchestrator.ingest()

    expect(result.processed).toContain('old.md')
    expect(result.summary.deleted).toBe(1)
    expect(fs.existsSync(path.join(knowledgePath, 'sources', 'old.md'))).toBe(false)
  })

  it('creates git commits', async () => {
    writeFile(path.join(rawPath, 'a.md'), '# A\n')
    const orchestrator = new IngestOrchestrator(rawPath, knowledgePath)
    await orchestrator.ingest()

    // Git repo should exist and have a commit
    expect(fs.existsSync(path.join(workspace, '.git'))).toBe(true)
  })

  it('is idempotent for unchanged files', async () => {
    writeFile(path.join(rawPath, 'stable.md'), '# Stable\n')
    const orchestrator = new IngestOrchestrator(rawPath, knowledgePath)
    await orchestrator.ingest()
    const result2 = await orchestrator.ingest()

    expect(result2.summary.unchanged).toBe(1)
    expect(result2.summary.added).toBe(0)
    expect(result2.summary.modified).toBe(0)
  })
})
