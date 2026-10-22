import type { TestWorld } from '@test/fixtures/kernel'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { INSTALLATION_FILE_NAME, INSTALLATION_ID_PATTERN, installationId } from './installation'

type PatternSchema = Readonly<{ pattern?: string }>
type OpenApiDocument = Readonly<{
  components: {
    schemas: { DeviceCodeRequest: { properties: { installation_id: { anyOf: PatternSchema[] } } } }
  }
}>

// The server's DeviceCodeRequest pattern, as the generated OpenAPI contract publishes it.
function serverInstallationIdPattern(): RegExp {
  const contract = JSON.parse(
    readFileSync(
      new URL('../../../packages/contracts/openapi/openapi-openapi.json', import.meta.url),
      'utf8',
    ),
  ) as OpenApiDocument
  const { anyOf } = contract.components.schemas.DeviceCodeRequest.properties.installation_id
  const pattern = anyOf.find((schema) => schema.pattern !== undefined)?.pattern
  if (pattern === undefined) throw new Error('DeviceCodeRequest.installation_id has no pattern')
  return new RegExp(pattern)
}

const SERVER_ID_PATTERN = serverInstallationIdPattern()

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
  expect(first).toMatch(SERVER_ID_PATTERN)
  expect(await installationId(w.ctx)).toBe(first)
  expect(await installationId(new Context())).toBe(first)
  expect(readFileSync(join(w.dir, INSTALLATION_FILE_NAME), 'utf8')).toBe(`id: ${first}\n`)
})

it('generates an id the server accepts', async () => {
  const w = await world()
  const id = await installationId(w.ctx)
  expect(id).toMatch(SERVER_ID_PATTERN)
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
    expect(INSTALLATION_ID_PATTERN.test(id)).toBe(SERVER_ID_PATTERN.test(id))
})

it('replaces an invalid stored id instead of sending it', async () => {
  const w = await world()
  writeFileSync(join(w.dir, INSTALLATION_FILE_NAME), 'id: "x y"\n')
  const id = await installationId(w.ctx)
  expect(id).toMatch(SERVER_ID_PATTERN)
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
  expect(id).toMatch(SERVER_ID_PATTERN)
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
