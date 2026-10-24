import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { folderLister, isLocalFolder, listLocalFolder } from './files'

const LOCKED = 'locked'
const MIB = 1024 * 1024

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

it('tells a folder from a file and a missing path', async () => {
  const file = join(root, 'f.txt')
  await writeFile(file, 'f')
  expect(await isLocalFolder(root)).toBe(true)
  expect(await isLocalFolder(file)).toBe(false)
  expect(await isLocalFolder(join(root, 'missing'))).toBe(false)
})

it('allows a folder at the file limit and refuses one over it', async () => {
  const listTwo = folderLister({ files: 2, mebibytes: 1 })
  await writeFile(join(root, 'a.txt'), 'a')
  await writeFile(join(root, '.DS_Store'), '')
  await writeFile(join(root, 'b.txt'), 'b')
  expect(await listTwo(root)).toEqual(['a.txt', 'b.txt'])
  await writeFile(join(root, 'c.txt'), 'c')
  await expect(listTwo(root)).rejects.toMatchObject({
    code: 'input_invalid',
    message: `folder "${root}" has more than 2 files`,
  })
})

it('refuses a folder over the size limit', async () => {
  const listOneMib = folderLister({ files: 10, mebibytes: 1 })
  await writeFile(join(root, 'a.bin'), new Uint8Array(MIB))
  expect(await listOneMib(root)).toEqual(['a.bin'])
  await writeFile(join(root, 'b.bin'), 'b')
  await expect(listOneMib(root)).rejects.toMatchObject({
    code: 'input_invalid',
    message: `folder "${root}" is larger than 1 MiB`,
  })
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
  'names the unreadable subfolder',
  async () => {
    await mkdir(join(root, LOCKED))
    await chmod(join(root, LOCKED), 0o000)
    await expect(listLocalFolder(root)).rejects.toMatchObject({
      code: 'input_invalid',
      message: `cannot read folder "${join(root, LOCKED)}"`,
    })
  },
)
