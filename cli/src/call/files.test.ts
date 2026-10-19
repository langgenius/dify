import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { listLocalFolder } from './files'

const LOCKED = 'locked'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'difyctl-files-'))
})

afterEach(async () => {
  await chmod(join(root, LOCKED), 0o700).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
})

it('lists files recursively, sorted, with / keys', async () => {
  await writeFile(join(root, 'b.txt'), 'b')
  await mkdir(join(root, 'a'))
  await writeFile(join(root, 'a', 'x.md'), 'x')
  await writeFile(join(root, 'a', '.env'), 'e')
  expect(await listLocalFolder(root)).toEqual(['a/.env', 'a/x.md', 'b.txt'])
})

it('skips OS junk', async () => {
  for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini', 'keep.txt']) {
    await writeFile(join(root, name), '')
  }
  await mkdir(join(root, '__MACOSX', 'a'), { recursive: true })
  await writeFile(join(root, '__MACOSX', 'a', '._x'), '')
  expect(await listLocalFolder(root)).toEqual(['keep.txt'])
})

it('keeps a regular file that shares a junk folder name', async () => {
  await writeFile(join(root, '__MACOSX'), 'm')
  expect(await listLocalFolder(root)).toEqual(['__MACOSX'])
})

it('returns [] when only junk is left', async () => {
  await writeFile(join(root, '.DS_Store'), '')
  expect(await listLocalFolder(root)).toEqual([])
})

it('returns undefined for a file and for a missing path', async () => {
  const file = join(root, 'f.txt')
  await writeFile(file, 'f')
  expect(await listLocalFolder(file)).toBeUndefined()
  expect(await listLocalFolder(join(root, 'missing'))).toBeUndefined()
})

it.skipIf(platform() === 'win32')('rejects a symlink', async () => {
  await symlink('..', join(root, 'loop'))
  await expect(listLocalFolder(root)).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining('loop'),
  })
})

it.skipIf(platform() === 'win32')('names a nested symlink by its full path', async () => {
  await mkdir(join(root, 'sub'))
  await symlink('..', join(root, 'sub', 'loop'))
  await expect(listLocalFolder(`${root}/`)).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining(`"${join(root, 'sub', 'loop')}" is a symlink`),
  })
})

it.skipIf(platform() === 'win32' || process.getuid?.() === 0)(
  'turns an unreadable subfolder into input_invalid',
  async () => {
    await mkdir(join(root, LOCKED))
    await chmod(join(root, LOCKED), 0o000)
    await expect(listLocalFolder(root)).rejects.toMatchObject({
      code: 'input_invalid',
      message: `cannot read folder "${root}"`,
    })
  },
)
