import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { localFile } from './local-file'

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
  await file.write({ name: 'a', size: 2, legacy: true } as z.output<typeof SCHEMA>)
  expect(readFileSync(path, 'utf8')).toBe('name: a\nsize: 2\n')
})

it('refuses to write a document the schema rejects', async () => {
  const file = localFile(path, SCHEMA, () => {})
  await expect(file.write({ name: 1 } as unknown as z.output<typeof SCHEMA>)).rejects.toThrow()
  expect(await file.read()).toBeNull()
})
