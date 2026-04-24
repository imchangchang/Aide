import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('node:fs')
vi.unmock('node:path')
vi.unmock('node:os')

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { NoteAgentService } from '../core/NoteAgentService'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'noteagent-service-'))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

describe('NoteAgentService', () => {
  let workspace: string
  let service: NoteAgentService

  beforeEach(() => {
    workspace = tmpDir()
    service = new NoteAgentService()
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('initializes workspace and reports status', async () => {
    const config = await service.init(workspace)

    expect(config.repoPath).toBe(workspace)
    expect(fs.existsSync(path.join(workspace, 'raw'))).toBe(true)
    expect(fs.existsSync(path.join(workspace, 'knowledge'))).toBe(true)
    expect(fs.existsSync(path.join(workspace, '.git'))).toBe(true)

    const status = await service.status()
    expect(status.initialized).toBe(true)
    expect(status.workspacePath).toBe(workspace)
    expect(status.hasCommits).toBe(false)
  })

  it('ingests raw files into knowledge', async () => {
    await service.init(workspace)
    writeFile(
      path.join(workspace, 'raw', 'hello.md'),
      '---\ntitle: Hello World\n---\n\n# Hello\n\nThis is a test note.\n'
    )

    const result = await service.ingest()
    expect(result.summary.added).toBe(1)
    expect(result.processed).toContain('hello.md')

    const sourcePage = fs.readFileSync(path.join(workspace, 'knowledge', 'sources', 'hello.md'), 'utf-8')
    expect(sourcePage).toContain('Hello World')
    expect(sourcePage).toContain('This is a test note.')

    const status = await service.status()
    expect(status.hasCommits).toBe(true)
    expect(status.recentCommits.length).toBeGreaterThan(0)
  })

  it('runs health check', async () => {
    await service.init(workspace)
    writeFile(path.join(workspace, 'knowledge', 'sources', 'a.md'), '# A\n')

    const report = await service.healthCheck()
    expect(report.issues.some((i) => i.type === 'empty-category')).toBe(true)
  })

  it('analyzes link graph', async () => {
    await service.init(workspace)
    writeFile(path.join(workspace, 'knowledge', 'sources', 'a.md'), '---\ntitle: Page A\n---\n\nSee [[Page B]]\n')
    writeFile(path.join(workspace, 'knowledge', 'sources', 'b.md'), '---\ntitle: Page B\n---\n\nSee [[Page A]]\n')

    const { stats } = await service.analyzeGraph()
    expect(stats.totalNodes).toBe(2)
    expect(stats.totalEdges).toBe(2)
  })

  it('queries knowledge by keyword', async () => {
    await service.init(workspace)
    writeFile(
      path.join(workspace, 'knowledge', 'sources', 'apple.md'),
      '---\ntitle: Apple Notes\n---\n\n# Apple\n\nApple is a fruit.\n'
    )
    writeFile(
      path.join(workspace, 'knowledge', 'sources', 'banana.md'),
      '---\ntitle: Banana Notes\n---\n\n# Banana\n\nBanana is yellow.\n'
    )

    const result = await service.query('apple')
    expect(result.pages.length).toBe(1)
    expect(result.pages[0].title).toBe('Apple Notes')
    expect(result.pages[0].excerpt.toLowerCase()).toContain('apple')
  })

  it('rebuilds index', async () => {
    await service.init(workspace)
    writeFile(path.join(workspace, 'knowledge', 'sources', 'x.md'), '---\ntitle: X\n---\n\n# X\n')

    await service.rebuildIndex()
    const indexContent = fs.readFileSync(path.join(workspace, 'knowledge', 'index.md'), 'utf-8')
    expect(indexContent).toContain('[[X]]')
  })

  it('throws when calling methods before init', async () => {
    await expect(service.ingest()).rejects.toThrow('not initialized')
    await expect(service.healthCheck()).rejects.toThrow('not initialized')
    await expect(service.query('test')).rejects.toThrow('not initialized')
  })
})
