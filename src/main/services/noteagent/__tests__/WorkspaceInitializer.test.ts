import { describe, expect, it, vi } from 'vitest'

vi.unmock('node:fs')
vi.unmock('node:path')

import * as fs from 'node:fs'
import * as path from 'node:path'

import { WorkspaceInitializer } from '../core/WorkspaceInitializer'

describe('WorkspaceInitializer', () => {
  const tmpDir = () => path.join('/tmp', `workspace-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)

  it('should create all directories and init git', async () => {
    const dir = tmpDir()

    const init = new WorkspaceInitializer(dir)
    const config = await init.init()

    // Verify paths
    expect(config.repoPath).toBe(dir)
    expect(config.rawPath).toBe(path.join(dir, 'raw'))
    expect(config.knowledgePath).toBe(path.join(dir, 'knowledge'))
    expect(config.graphPath).toBe(path.join(dir, 'graph'))

    // Verify directories exist
    const dirs = [
      dir,
      path.join(dir, 'raw'),
      path.join(dir, 'raw', 'notes'),
      path.join(dir, 'raw', 'uploads'),
      path.join(dir, 'knowledge'),
      path.join(dir, 'knowledge', 'sources'),
      path.join(dir, 'knowledge', 'entities'),
      path.join(dir, 'knowledge', 'concepts'),
      path.join(dir, 'knowledge', 'syntheses'),
      path.join(dir, 'graph')
    ]
    for (const d of dirs) {
      const stat = await fs.promises.stat(d)
      expect(stat.isDirectory()).toBe(true)
    }

    // Verify git initialized
    const gitDir = path.join(dir, '.git')
    const gitStat = await fs.promises.stat(gitDir)
    expect(gitStat.isDirectory()).toBe(true)

    // Verify .gitignore exists
    const gitignorePath = path.join(dir, '.gitignore')
    const gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf-8')
    expect(gitignoreContent).toContain('.DS_Store')
    expect(gitignoreContent).toContain('*.tmp')
  })

  it('should be idempotent on re-init', async () => {
    const dir = tmpDir()

    const init = new WorkspaceInitializer(dir)
    await init.init()
    await init.init() // should not throw

    const gitDir = path.join(dir, '.git')
    const stat = await fs.promises.stat(gitDir)
    expect(stat.isDirectory()).toBe(true)
  })

  it('should report isInitialized correctly', async () => {
    const dir = tmpDir()

    const init = new WorkspaceInitializer(dir)
    expect(await init.isInitialized()).toBe(false)

    await init.init()
    expect(await init.isInitialized()).toBe(true)
  })
})
