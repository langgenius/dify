import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { ENTRY_KIND, walkTree } from './tree'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'difyctl-tree-'))
  await writeFile(join(root, 'a.txt'), 'a')
  await mkdir(join(root, 'sub'))
  await writeFile(join(root, 'sub', 'b.txt'), 'b')
  await mkdir(join(root, 'empty'))
})

afterEach(() => rm(root, { recursive: true, force: true }))

it('walkTree lists nested entries with / paths and their kinds', async () => {
  const entries = [...(await walkTree(root))].sort((a, b) => a.path.localeCompare(b.path))
  expect(entries).toEqual([
    { path: 'a.txt', kind: ENTRY_KIND.File },
    { path: 'empty', kind: ENTRY_KIND.Directory },
    { path: 'sub', kind: ENTRY_KIND.Directory },
    { path: 'sub/b.txt', kind: ENTRY_KIND.File },
  ])
})

it.skipIf(platform() === 'win32')('walkTree lists a symlink as its own kind', async () => {
  await symlink('a.txt', join(root, 'link'))
  expect(await walkTree(root)).toContainEqual({ path: 'link', kind: ENTRY_KIND.Symlink })
})

it.skipIf(platform() === 'win32')('walkTree does not descend into a symlinked folder', async () => {
  await symlink('sub', join(root, 'sublink'))
  const entries = await walkTree(root)
  expect(entries).toContainEqual({ path: 'sublink', kind: ENTRY_KIND.Symlink })
  expect(entries.map((entry) => entry.path)).not.toContain('sublink/b.txt')
})

it.skipIf(platform() === 'win32')(
  'walkTree reports a nested symlink by its nested path',
  async () => {
    await symlink('..', join(root, 'sub', 'loop'))
    expect(await walkTree(root)).toContainEqual({ path: 'sub/loop', kind: ENTRY_KIND.Symlink })
  },
)
