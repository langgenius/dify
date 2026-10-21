import type { FolderLimits } from './files'
import { Buffer } from 'node:buffer'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { expect, it } from 'vite-plus/test'
import { assertExtractTarget, extractZip } from './extract'

const LIMITS: FolderLimits = { files: 5000, mebibytes: 512 }

function zip(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])))
}

function parent(): string {
  return mkdtempSync(join(tmpdir(), 'difyctl-extract-'))
}

type Overrides = Partial<{ limits: FolderLimits; signal: AbortSignal }>

function extract(bytes: Uint8Array, target: string, overrides: Overrides = {}) {
  const signal = new AbortController().signal
  return extractZip({ bytes, target, limits: LIMITS, signal, ...overrides })
}

it('creates the folder, writes every file and reports the file count and bytes', async () => {
  const target = join(parent(), 'app')
  const bytes = zipSync({
    'app.yaml': strToU8('kind: app'),
    's_000001/': new Uint8Array(),
    's_000001/SKILL.md': strToU8('# skill'),
    's_000001/scripts/run.sh': strToU8('echo'),
  })
  expect(await extract(bytes, target)).toEqual({ path: target, files: 3, size: 20 })
  expect(readFileSync(join(target, 'app.yaml'), 'utf8')).toBe('kind: app')
  expect(readFileSync(join(target, 's_000001/scripts/run.sh'), 'utf8')).toBe('echo')
})

it('extracts into a folder that already has other files and leaves them alone', async () => {
  const target = parent()
  writeFileSync(join(target, 'notes.txt'), 'mine')
  mkdirSync(join(target, 's_000001'))
  writeFileSync(join(target, 's_000001', 'keep.md'), 'mine too')
  await extract(zip({ 'app.yaml': 'a', 's_000001/SKILL.md': 's' }), target)
  expect(readdirSync(target).sort()).toEqual(['app.yaml', 'notes.txt', 's_000001'])
  expect(readdirSync(join(target, 's_000001')).sort()).toEqual(['SKILL.md', 'keep.md'])
  expect(readFileSync(join(target, 'notes.txt'), 'utf8')).toBe('mine')
})

it('extracts into the current folder given as .', async () => {
  const dir = parent()
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    const receipt = await extract(zip({ 'x.txt': 'x' }), '.')
    expect(receipt).toMatchObject({ path: process.cwd(), files: 1 })
    expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toBe('x')
  } finally {
    process.chdir(cwd)
  }
})

it('leaves a nested zip as a file', async () => {
  const target = join(parent(), 'app')
  const inner = zip({ 'SKILL.md': '# skill' })
  await extract(zipSync({ 's_000001.zip': inner }), target)
  expect(readFileSync(join(target, 's_000001.zip'))).toEqual(Buffer.from(inner))
})

it('refuses a zip whose files already exist and writes nothing', async () => {
  const target = parent()
  writeFileSync(join(target, 'app.yaml'), 'old')
  await expect(extract(zip({ 'app.yaml': 'new', 'b.txt': 'b' }), target)).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: `${target} already has app.yaml; not extracting into it`,
    hint: 'pass --extract <path> naming a new folder',
  })
  expect(readdirSync(target)).toEqual(['app.yaml'])
  expect(readFileSync(join(target, 'app.yaml'), 'utf8')).toBe('old')
})

it('counts the clashes it does not list', async () => {
  const target = parent()
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `${n}.txt`)
  for (const name of names) writeFileSync(join(target, name), 'old')
  const bytes = zip(Object.fromEntries(names.map((n) => [n, 'new'])))
  await expect(extract(bytes, target)).rejects.toMatchObject({
    message: `${target} already has a.txt, b.txt, c.txt, d.txt, e.txt and 2 more; not extracting into it`,
  })
})

it('refuses a file or a link where the zip needs a folder', async () => {
  const fileInTheWay = parent()
  writeFileSync(join(fileInTheWay, 's_000001'), 'file')
  await expect(extract(zip({ 's_000001/SKILL.md': 's' }), fileInTheWay)).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: `${fileInTheWay} already has s_000001; not extracting into it`,
  })

  const linkInTheWay = parent()
  const elsewhere = parent()
  symlinkSync(elsewhere, join(linkInTheWay, 's_000001'))
  await expect(extract(zip({ 's_000001/SKILL.md': 's' }), linkInTheWay)).rejects.toMatchObject({
    code: 'usage_invalid_flag',
  })
  expect(readdirSync(elsewhere)).toEqual([])
})

it('refuses before the request a target that is a file or whose parent is missing', async () => {
  const dir = parent()
  writeFileSync(join(dir, 'app'), 'file')
  await expect(assertExtractTarget(join(dir, 'app'))).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: `${join(dir, 'app')} is not a folder; not extracting into it`,
  })
  await expect(assertExtractTarget(join(dir, 'missing', 'app'))).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: `the folder that would hold ${join(dir, 'missing', 'app')} does not exist`,
  })
  await expect(assertExtractTarget(join(dir, 'new'))).resolves.toBeUndefined()
  await expect(assertExtractTarget(dir)).resolves.toBeUndefined()
})

it('rejects a body that is not a zip and creates nothing', async () => {
  const dir = parent()
  await expect(extract(strToU8('kind: app'), join(dir, 'app'))).rejects.toMatchObject({
    code: 'server_error',
    message: 'response is not a valid zip archive',
  })
  expect(readdirSync(dir)).toEqual([])
})

it.each([
  '../escape.txt',
  'a/../../escape.txt',
  '/etc/passwd',
  'C:/x.txt',
  'a\\b.txt',
  'a//b.txt',
  './a.txt',
  'a/./b.txt',
])('rejects the unsafe entry name %s and creates nothing', async (name) => {
  const dir = parent()
  const bytes = zip({ 'ok.txt': 'ok', [name]: 'x' })
  await expect(extract(bytes, join(dir, 'app'))).rejects.toMatchObject({
    code: 'server_error',
    message: `response zip has an unsafe entry name: ${name}`,
  })
  expect(readdirSync(dir)).toEqual([])
})

it('rejects two entries that differ only in case', async () => {
  const bytes = zip({ 'App.yaml': 'a', 'app.yaml': 'b' })
  await expect(extract(bytes, join(parent(), 'app'))).rejects.toMatchObject({
    code: 'server_error',
    message: 'response zip has more than one entry named app.yaml',
  })
})

it('rejects a name used as both a file and a folder', async () => {
  const bytes = zip({ a: 'file', 'a/b.txt': 'x' })
  await expect(extract(bytes, join(parent(), 'app'))).rejects.toMatchObject({
    code: 'server_error',
    message: 'response zip uses a as both a file and a folder',
  })
})

it('rejects an entry the unzip step loses instead of dropping it', async () => {
  // fflate cannot zip this name either, so a same-length stand-in is renamed in place.
  const placeholder = Buffer.from('XXproto__')
  const bytes = Buffer.from(zipSync({ ok: strToU8('ok'), [placeholder.toString()]: strToU8('x') }))
  for (let at = bytes.indexOf(placeholder); at !== -1; at = bytes.indexOf(placeholder, at + 1))
    bytes.write('__proto__', at)
  await expect(extract(bytes, join(parent(), 'app'))).rejects.toMatchObject({
    code: 'server_error',
    message: 'response zip entry __proto__ could not be read',
  })
})

it('rejects a zip over the file limit', async () => {
  const bytes = zip({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' })
  const limits = { files: 2, mebibytes: 512 }
  await expect(extract(bytes, join(parent(), 'app'), { limits })).rejects.toMatchObject({
    code: 'server_error',
    message: 'response zip has more than 2 files',
  })
})

it('rejects a zip over the size limit, stored or deflated', async () => {
  const big = new Uint8Array(1024 * 1024 + 1)
  const limits = { files: 5000, mebibytes: 1 }
  for (const level of [0, 6] as const) {
    const bytes = zipSync({ 'big.bin': big }, { level })
    await expect(extract(bytes, join(parent(), 'app'), { limits })).rejects.toMatchObject({
      code: 'server_error',
      message: 'response zip is larger than 1 MiB',
    })
  }
})

it('on cancel removes only what it created', async () => {
  const cancelled = new AbortController()
  cancelled.abort()
  const signal = cancelled.signal

  const target = parent()
  writeFileSync(join(target, 'notes.txt'), 'mine')
  const bytes = zip({ 'app.yaml': 'a', 's_000001/SKILL.md': 's' })
  await expect(extract(bytes, target, { signal })).rejects.toMatchObject({
    code: 'unknown',
    message: `cancelled; removed what was extracted into ${target}`,
  })
  expect(readdirSync(target)).toEqual(['notes.txt'])

  const fresh = join(parent(), 'app')
  await expect(extract(zip({ 'a/b.txt': 'b' }), fresh, { signal })).rejects.toMatchObject({
    code: 'unknown',
  })
  expect(existsSync(fresh)).toBe(false)
})
