import type { TestWorld } from '@test/fixtures/kernel'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { INSTALLATION_FILE_NAME, INSTALLATION_ID_PATTERN, installationId } from './installation'

const SCHEMA_START = 'export const zDeviceCodeRequest = '
const SCHEMA_END = '\n})'

// The server's DeviceCodeRequest pattern, from the tracked generated zod contract. The CLI does not
// depend on @dify/contracts, and tsc rejects a relative import from outside the package.
function serverInstallationIdPattern(): RegExp {
  const source = readFileSync(
    new URL('../../../packages/contracts/generated/api/openapi/zod.gen.ts', import.meta.url),
    'utf8',
  )
  const start = source.indexOf(SCHEMA_START)
  if (start < 0) throw new Error('zod contract has no zDeviceCodeRequest')
  const schema = source.slice(start, source.indexOf(SCHEMA_END, start))
  const pattern = /installation_id: z\s*\.string\(\)\s*\.regex\(\/(.+)\/\)/.exec(schema)?.[1]
  if (pattern === undefined) throw new Error('zDeviceCodeRequest.installation_id has no regex')
  return new RegExp(pattern)
}

const SERVER_ID_PATTERN = serverInstallationIdPattern()

function serverAccepts(id: string): boolean {
  return SERVER_ID_PATTERN.test(id)
}

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

async function world(): Promise<TestWorld> {
  const w = await testContext({ login: false })
  worlds.push(w)
  return w
}

it('creates one installation id and keeps it', async () => {
  const w = await world()
  const first = await installationId(w.ctx)
  expect(serverAccepts(first)).toBe(true)
  expect(await installationId(w.ctx)).toBe(first)
  expect(await installationId(new Context())).toBe(first)
  expect(readFileSync(join(w.dir, INSTALLATION_FILE_NAME), 'utf8')).toBe(`id: ${first}\n`)
})

it('generates an id the server accepts', async () => {
  const w = await world()
  const id = await installationId(w.ctx)
  expect(serverAccepts(id)).toBe(true)
  expect(id).toMatch(INSTALLATION_ID_PATTERN)
})

it('accepts exactly the ids the server accepts', () => {
  for (const id of [
    'abcdefgh',
    'A1-b2-C3',
    'a'.repeat(64),
    'short',
    'a'.repeat(65),
    'x y-1234',
    'ab_cdefgh',
  ])
    expect(INSTALLATION_ID_PATTERN.test(id)).toBe(serverAccepts(id))
})

it('replaces an invalid stored id instead of sending it', async () => {
  const w = await world()
  writeFileSync(join(w.dir, INSTALLATION_FILE_NAME), 'id: "x y"\n')
  const id = await installationId(w.ctx)
  expect(serverAccepts(id)).toBe(true)
  expect(readFileSync(join(w.dir, INSTALLATION_FILE_NAME), 'utf8')).toBe(`id: ${id}\n`)
})

it.each([
  ['not YAML', 'id: [unclosed\n'],
  ['not a mapping', '- a\n- b\n'],
  ['empty', ''],
  ['missing the id', 'other: x\n'],
])('replaces a file that is %s with a fresh id', async (_name, content) => {
  const w = await world()
  writeFileSync(join(w.dir, INSTALLATION_FILE_NAME), content)
  const id = await installationId(w.ctx)
  expect(serverAccepts(id)).toBe(true)
  expect(await installationId(w.ctx)).toBe(id)
})

it('keeps a valid stored id', async () => {
  const w = await world()
  writeFileSync(join(w.dir, INSTALLATION_FILE_NAME), 'id: kept-id-1234\n')
  expect(await installationId(w.ctx)).toBe('kept-id-1234')
})

it('two config dirs get different ids', async () => {
  const a = await world()
  const idA = await installationId(a.ctx)
  const b = await world()
  expect(await installationId(b.ctx)).not.toBe(idA)
})

it('two processes starting at once end up with the same id', async () => {
  const w = await world()
  const ids = await Promise.all([
    installationId(new Context()),
    installationId(new Context()),
    installationId(new Context()),
  ])
  expect(new Set(ids).size).toBe(1)
  expect(readFileSync(join(w.dir, INSTALLATION_FILE_NAME), 'utf8')).toBe(`id: ${ids[0]}\n`)
})
