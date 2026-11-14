import type { TreeEntry } from './tree'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { ENTRY_KIND, walkTree } from './tree'

const LOCKED = 'locked'

let root: string

async function walkAll(dir: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []
  for await (const entry of walkTree(dir)) entries.push(entry)
  return entries
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'difyctl-tree-'))
  await writeFile(join(root, 'a.txt'), 'a')
  await mkdir(join(root, 'sub'))
  await writeFile(join(root, 'sub', 'b.txt'), 'b')
  await mkdir(join(root, 'empty'))
})

afterEach(async () => {
  await chmod(join(root, LOCKED), 0o700).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
})

it('walkTree lists nested entries with / paths and their kinds', async () => {
  const entries = (await walkAll(root)).sort((a, b) => a.path.localeCompare(b.path))
  expect(entries).toEqual([
    { path: 'a.txt', kind: ENTRY_KIND.File },
    { path: 'empty', kind: ENTRY_KIND.Directory },
    { path: 'sub', kind: ENTRY_KIND.Directory },
    { path: 'sub/b.txt', kind: ENTRY_KIND.File },
  ])
})

it.skipIf(platform() === 'win32')('walkTree lists a symlink as its own kind', async () => {
  await symlink('a.txt', join(root, 'link'))
  expect(await walkAll(root)).toContainEqual({ path: 'link', kind: ENTRY_KIND.Symlink })
})

it.skipIf(platform() === 'win32')('walkTree does not descend into a symlinked folder', async () => {
  await symlink('sub', join(root, 'sublink'))
  const entries = await walkAll(root)
  expect(entries).toContainEqual({ path: 'sublink', kind: ENTRY_KIND.Symlink })
  expect(entries.map((entry) => entry.path)).not.toContain('sublink/b.txt')
})

it.skipIf(platform() === 'win32')(
  'walkTree reports a nested symlink by its nested path',
  async () => {
    await symlink('..', join(root, 'sub', 'loop'))
    expect(await walkAll(root)).toContainEqual({ path: 'sub/loop', kind: ENTRY_KIND.Symlink })
  },
)

it.skipIf(platform() === 'win32' || process.getuid?.() === 0)(
  'walkTree reads no further once the caller stops',
  async () => {
    await mkdir(join(root, LOCKED))
    await chmod(join(root, LOCKED), 0o000)
    await expect(walkAll(root)).rejects.toThrow()
    const seen: TreeEntry[] = []
    for await (const entry of walkTree(root)) {
      seen.push(entry)
      break
    }
    expect(seen).toHaveLength(1)
  },
)
