import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { localFile, REMOVE } from './local-file'

const SCHEMA = z.object({ name: z.string(), size: z.number().default(1) })

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'difyctl-local-file-'))
  path = join(dir, 'doc.yml')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('writes the whole file in the schema shape, dropping keys the schema does not know', async () => {
  const file = localFile(path, SCHEMA, () => {})
  await file.update(() => ({ name: 'a', size: 2, legacy: true }) as z.output<typeof SCHEMA>)
  expect(readFileSync(path, 'utf8')).toBe('name: a\nsize: 2\n')
})

it('refuses to write a document the schema rejects', async () => {
  const file = localFile(path, SCHEMA, () => {})
  await expect(
    file.update(() => ({ name: 1 }) as unknown as z.output<typeof SCHEMA>),
  ).rejects.toThrow()
  expect(await file.read()).toBeNull()
})

it('changes the latest document, not one read earlier', async () => {
  const file = localFile(path, SCHEMA, () => {})
  writeFileSync(path, 'name: a\n')
  expect(await file.read()).toEqual({ name: 'a', size: 1 })
  writeFileSync(path, 'name: b\nsize: 5\n')
  await file.update((doc) => (doc === null ? undefined : { ...doc, size: doc.size + 1 }))
  expect(readFileSync(path, 'utf8')).toBe('name: b\nsize: 6\n')
})

it('removes the file only when the change says REMOVE', async () => {
  const file = localFile(path, SCHEMA, () => {})
  writeFileSync(path, 'name: a\n')
  await file.update((doc) => (doc?.name === 'b' ? REMOVE : undefined))
  expect(existsSync(path)).toBe(true)
  await file.update((doc) => (doc?.name === 'a' ? REMOVE : undefined))
  expect(existsSync(path)).toBe(false)
})

it('reports each problem with a file once, however often it is read', async () => {
  writeFileSync(path, 'name: a\nsize: big\n')
  const notices: string[] = []
  const file = localFile(path, SCHEMA, (text) => notices.push(text))
  await file.read()
  await file.read()
  await file.update((doc) => doc ?? undefined)
  expect(notices).toEqual([`${path}: ignoring the invalid value of size`])
})

const NESTED = z.object({
  host: z.string(),
  account: z.object({ id: z.string(), name: z.string() }).optional(),
  tags: z.array(z.object({ key: z.string() })).default([]),
})

function readNested(yaml: string) {
  writeFileSync(path, yaml)
  const notices: string[] = []
  return { notices, doc: localFile(path, NESTED, (text) => notices.push(text)).read() }
}

it('drops a bad nested leaf by dropping the nearest value that exists on its path', async () => {
  const { notices, doc } = readNested('host: h\naccount:\n  id: 1\n  name: n\n')
  expect(await doc).toEqual({ host: 'h', tags: [] })
  expect(notices).toEqual([
    `${path}: ignoring the invalid value of account.id`,
    `${path}: ignoring the invalid value of account`,
  ])
})

it('drops an optional parent whose required key is missing', async () => {
  const { notices, doc } = readNested('host: h\naccount:\n  id: a\n')
  expect(await doc).toEqual({ host: 'h', tags: [] })
  expect(notices).toEqual([`${path}: ignoring the invalid value of account`])
})

it('drops only the bad items of an array', async () => {
  const { doc } = readNested('host: h\ntags:\n  - key: a\n  - key: 2\n  - {}\n  - key: d\n')
  expect(await doc).toEqual({ host: 'h', tags: [{ key: 'a' }, { key: 'd' }] })
})

it('drops a parent that is not a mapping at all', async () => {
  const { doc } = readNested('host: h\naccount: plain\n')
  expect(await doc).toEqual({ host: 'h', tags: [] })
})

it('ignores the file when a required top-level key is missing', async () => {
  const { notices, doc } = readNested('account:\n  id: a\n  name: n\n')
  expect(await doc).toBeNull()
  expect(notices).toEqual([`${path} has no valid host; ignoring it`])
})
