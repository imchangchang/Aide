import { describe, expect, it, vi } from 'vitest'

vi.unmock('node:fs')
vi.unmock('node:path')

import * as fs from 'node:fs'
import * as path from 'node:path'

import { GitTracker } from '../core/GitTracker'

describe('GitTracker', () => {
  const tmpDir = () => path.join('/tmp', `git-tracker-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)

  it('should initialize a git repo', async () => {
    const dir = tmpDir()
    await fs.promises.mkdir(dir, { recursive: true })

    const tracker = new GitTracker(dir)
    await tracker.init('main')

    const gitDir = path.join(dir, '.git')
    const stat = await fs.promises.stat(gitDir)
    expect(stat.isDirectory()).toBe(true)
  })

  it('should be idempotent on re-init', async () => {
    const dir = tmpDir()
    await fs.promises.mkdir(dir, { recursive: true })

    const tracker = new GitTracker(dir)
    await tracker.init('main')
    await tracker.init('main') // should not throw

    const gitDir = path.join(dir, '.git')
    const stat = await fs.promises.stat(gitDir)
    expect(stat.isDirectory()).toBe(true)
  })

  it('should stage and commit a file', async () => {
    const dir = tmpDir()
    await fs.promises.mkdir(dir, { recursive: true })

    const tracker = new GitTracker(dir)
    await tracker.init('main')

    // Write a file
    await fs.promises.writeFile(path.join(dir, 'hello.md'), '# Hello', 'utf-8')

    // Stage and commit
    const oid = await tracker.stageAndCommit('test: add hello.md')
    expect(oid).toBeTruthy()
    expect(oid.length).toBe(40) // SHA-1 hash

    // Verify log
    const log = await tracker.log({ depth: 1 })
    expect(log).toHaveLength(1)
    expect(log[0].message).toBe('test: add hello.md')
    expect(log[0].author.name).toBe('NoteAgent')
  })

  it('should track multiple commits', async () => {
    const dir = tmpDir()
    await fs.promises.mkdir(dir, { recursive: true })

    const tracker = new GitTracker(dir)
    await tracker.init('main')

    await fs.promises.writeFile(path.join(dir, 'a.md'), 'A', 'utf-8')
    await tracker.stageAndCommit('commit 1')

    await fs.promises.writeFile(path.join(dir, 'b.md'), 'B', 'utf-8')
    await tracker.stageAndCommit('commit 2')

    const log = await tracker.log({ depth: 10 })
    expect(log).toHaveLength(2)
    expect(log[0].message).toBe('commit 2')
    expect(log[1].message).toBe('commit 1')
  })

  it('should report status correctly', async () => {
    const dir = tmpDir()
    await fs.promises.mkdir(dir, { recursive: true })

    const tracker = new GitTracker(dir)
    await tracker.init('main')

    // Untracked file
    await fs.promises.writeFile(path.join(dir, 'new.md'), 'new', 'utf-8')
    const status = await tracker.status('new.md')
    expect(status.status).toBe('added') // isomorphic-git reports untracked new files as 'added'
  })

  it('should detect diff between working tree and HEAD', async () => {
    const dir = tmpDir()
    await fs.promises.mkdir(dir, { recursive: true })

    const tracker = new GitTracker(dir)
    await tracker.init('main')

    await fs.promises.writeFile(path.join(dir, 'file.md'), 'v1', 'utf-8')
    await tracker.stageAndCommit('add file')

    // Modify file
    await fs.promises.writeFile(path.join(dir, 'file.md'), 'v2', 'utf-8')

    const diff = await tracker.diff()
    expect(diff).toHaveLength(1)
    expect(diff[0].path).toBe('file.md')
    expect(diff[0].type).toBe('modified')
  })

  it('should report hasCommits correctly', async () => {
    const dir = tmpDir()
    await fs.promises.mkdir(dir, { recursive: true })

    const tracker = new GitTracker(dir)
    await tracker.init('main')

    expect(await tracker.hasCommits()).toBe(false)

    await fs.promises.writeFile(path.join(dir, 'x.md'), 'x', 'utf-8')
    await tracker.stageAndCommit('first')

    expect(await tracker.hasCommits()).toBe(true)
  })
})
