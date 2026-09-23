import type { TestWorld } from '@test/fixtures/kernel'
import type { CommandTree } from '@/plugins/commands/registry'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { parseCatalog } from '@/plugins/catalog'
import { Command } from '@/plugins/commands/command'
import { propertiesOf } from '@/protocol/shape'
import { commands, runPipeline } from './index'

// What the mock serves by default, so an op's descriptor and its errors can be compared.
const FIXTURE_OPS = parseCatalog(
  readFileSync(join(__dirname, '../../../test/fixtures/catalog.json')),
).ops

const worlds: TestWorld[] = []
async function world(login: boolean, argv: string[]) {
  const w = await testContext({ login, argv })
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('bare difyctl prints a pointer to help and the skill, and makes no request', async () => {
  const w = await world(true, [])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toEqual({
    message: 'difyctl has no built-in business commands; every server operation is a command',
    help: 'difyctl help',
    skill: 'difyctl install skills <dir>',
  })
  expect(w.mock.requestCount).toBe(0)
})

it('the map is one tree: leaves carry a summary, groups a count and sub-groups', async () => {
  const w = await world(true, ['help'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const map = JSON.parse(w.io.outBuf())
  expect(map.login).toMatchObject({ summary: expect.any(String), count: 1, groups: [] })
  expect(map.run).toMatchObject({
    count: expect.any(Number),
    groups: expect.arrayContaining(['console_app']),
  })
  expect(map.list.groups).toEqual(expect.arrayContaining(['workspace']))
  expect(map.call).toBeUndefined()
  expect(map.ops).toBeUndefined()
  expect(w.io.outBuf()).toMatch(/\n {2}"login"/)
  expect(w.mock.requestCount).toBe(1) // the catalog fetch, nothing else
})

it('on a terminal the map is text, not JSON', async () => {
  const w = await testContext({ login: true, argv: ['help'], tty: true })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const out = w.io.outBuf()
  expect(out).toContain('console_app')
  expect(out).not.toMatch(/[{}]/)
})

it('the map with no server known is the static half and says so on stderr', async () => {
  const w = await world(false, ['help'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const map = JSON.parse(w.io.outBuf())
  expect(map.version).toMatchObject({ count: 1 })
  expect(map.console_app).toBeUndefined()
  expect(w.io.errBuf()).toMatch(/log in to list server operations/)
  expect(w.mock.requestCount).toBe(0)
})

it('the map still prints the static half when the catalog cannot be fetched', async () => {
  const w = await world(true, ['help'])
  w.mock.setScenario('no-catalog')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const map = JSON.parse(w.io.outBuf())
  expect(map.version).toMatchObject({ count: 1 })
  expect(map.console_app).toBeUndefined()
  expect(w.io.errBuf().trim().split('\n')).toHaveLength(1)
  expect(w.io.errBuf()).toMatch(/^could not list server operations: failed to fetch the catalog: /)
})

it('help accepts a dotted id and prints the same descriptor as the spaced path', async () => {
  const a = await world(true, ['help', 'run.console_app.workflow'])
  const b = await world(true, ['run', 'console_app', 'workflow', '--help'])
  await (await a.ctx.get(commands)).run()
  await (await b.ctx.get(commands)).run()
  expect(JSON.parse(a.io.outBuf())).toEqual(JSON.parse(b.io.outBuf()))
  expect(JSON.parse(a.io.outBuf())).toMatchObject({
    id: 'run console_app workflow',
    op: 'run.console_app.workflow',
    kind: 'sse',
  })
})

it('a namespace without a command lists what is under it, with or without the help word', async () => {
  const a = await world(true, ['run'])
  expect(await (await a.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(a.io.outBuf()).entries.map((e: { id: string }) => e.id)).toContain(
    'run console_app workflow',
  )

  const b = await world(true, ['help', 'run', 'console_app'])
  expect(await (await b.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(b.io.outBuf()).entries.map((e: { id: string }) => e.id)).toEqual([
    'run console_app advanced_chat',
    'run console_app chat',
    'run console_app completion',
    'run console_app workflow',
  ])
})

it('an internal op stays out of the listing, comes back under --all, and always resolves', async () => {
  const a = await world(true, ['help', 'workspace'])
  expect(await (await a.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(a.io.outBuf()).entries.map((e: { id: string }) => e.id)).not.toContain(
    'switch workspace',
  )

  const b = await world(true, ['help', 'workspace', '--all'])
  expect(await (await b.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(b.io.outBuf()).entries.map((e: { id: string }) => e.id)).toContain(
    'switch workspace',
  )

  const c = await world(true, ['switch', 'workspace', '--help'])
  expect(await (await c.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(c.io.outBuf())).toMatchObject({
    id: 'switch workspace',
    op: 'switch.workspace',
  })
})

it('search reaches a word that only a field name carries', async () => {
  const w = await world(true, ['help', 'attachments'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const found = JSON.parse(w.io.outBuf())
  expect(found.total).toBeGreaterThan(0)
  expect(found.entries.map((e: { id: string }) => e.id)).toContain('run console_app workflow')
})

it('help routes a word to a namespace listing or a search, and --full is the flat list', async () => {
  const c = await world(true, ['help', 'list'])
  await (await c.ctx.get(commands)).run()
  const ids = JSON.parse(c.io.outBuf()).entries.map((e: { id: string }) => e.id)
  expect(ids).toContain('list skills')
  expect(ids).toContain('list workspace member')
  expect(ids).toEqual([...ids].sort())

  const d = await world(true, ['help', 'chatbot'])
  await (await d.ctx.get(commands)).run()
  expect(JSON.parse(d.io.outBuf()).entries[0]).toMatchObject({
    id: 'run console_app chat',
    kind: 'sse',
  })
  const e = await world(true, ['help', 'zebra'])
  await (await e.ctx.get(commands)).run()
  expect(JSON.parse(e.io.outBuf())).toEqual({ entries: [], total: 0 })
  expect(e.io.errBuf().trim()).toBe('nothing matched; run difyctl help for the map')

  const f = await world(true, ['help', '--full'])
  await (await f.ctx.get(commands)).run()
  const full = JSON.parse(f.io.outBuf())
  expect(full.commands[0]).toHaveProperty('usage')
  expect(full.commands.map((row: { id: string }) => row.id)).toContain('run console_app workflow')
})

it('help on a command prints its row; --help anywhere and the help word both work', async () => {
  const a = await world(false, ['version', '--help'])
  await (await a.ctx.get(commands)).run()
  expect(JSON.parse(a.io.outBuf())).toMatchObject({
    id: 'version',
    usage: expect.stringContaining('difyctl version'),
  })
  const b = await world(false, ['help', 'version'])
  await (await b.ctx.get(commands)).run()
  expect(JSON.parse(b.io.outBuf()).id).toBe('version')
})

it('unknown command is exit 2 with a suggestion', async () => {
  const w = await world(false, ['versoin'])
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    hint: expect.stringContaining('version'),
  })
})

it('an unknown flag is exit 2', async () => {
  const w = await world(false, ['version', '--bogus'])
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
  })
})

const FAKE_INPUT = z.object({ name: z.string().optional(), dry_run: z.boolean().default(false) })

class Fake extends Command<typeof FAKE_INPUT> {
  static override input = FAKE_INPUT
  async run(input: z.infer<typeof FAKE_INPUT>) {
    return input
  }
}

const fakeTree: CommandTree = { fake: { command: Fake, subcommands: {} } }

it('applies the schema defaults before run and prints the result indented', async () => {
  const w = await world(false, ['fake'])
  expect(await runPipeline(fakeTree, w.ctx)).toBe(0)
  expect(w.io.outBuf()).toBe('{\n  "dry_run": false\n}\n')
})

it('takes --verbose anywhere and keeps it out of the command input', async () => {
  const a = await world(false, ['version', '--verbose'])
  expect(await (await a.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(a.io.outBuf()).client.version).toBe('0.0.0-test')
  const b = await world(false, ['--verbose', 'version'])
  expect(await (await b.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(b.io.outBuf()).client.version).toBe('0.0.0-test')
  const c = await world(false, ['nope', '--verbose'])
  await expect((await c.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
  })
})

it('the map reuses a cached catalog instead of fetching again', async () => {
  const w = await world(true, ['help'])
  await (await w.ctx.get(commands)).run()
  expect(w.mock.requestCount).toBe(1)
  const reusing = await testContext({ login: true, argv: ['help'], reuseDirOf: w })
  worlds.push(reusing)
  await (await reusing.ctx.get(commands)).run()
  expect(JSON.parse(reusing.io.outBuf()).list.count).toBeGreaterThan(3)
  expect(reusing.mock.requestCount).toBe(1)
})

it('a catalog op resolves as a spaced command and takes its fields as flags', async () => {
  const w = await world(true, ['list', 'console_app', '--limit', '2'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.lastRequest?.path).toContain('limit=2')
})

it('a command word may be spelled with dashes where the op id has underscores', async () => {
  const w = await world(true, ['list', 'console-app'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.lastRequest?.path).toBe('/openapi/v1/apps?workspace_id=ws-1')

  const help = await world(true, ['list', 'console-app', '--help'])
  expect(await (await help.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(help.io.outBuf())).toMatchObject({
    id: 'list console_app',
    usage: 'difyctl list console_app [flags]',
  })
})

it('an unknown path refetches the catalog once before giving up', async () => {
  const w = await world(true, ['list', 'nope'])
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: 'unknown command: list nope',
    hint: 'run difyctl help',
  })
  expect(w.mock.requestCount).toBe(2) // the cached catalog, then one refetch

  const typo = await world(true, ['list', 'consol_app'])
  await expect((await typo.ctx.get(commands)).run()).rejects.toMatchObject({
    hint: 'did you mean: list console_app',
  })
})

it('a known namespace and a help view answer from the cached catalog, with no refetch', async () => {
  const a = await world(true, ['run'])
  expect(await (await a.ctx.get(commands)).run()).toBe(0)
  expect(a.mock.requestCount).toBe(1)

  const b = await world(true, ['help', 'workspace'])
  expect(await (await b.ctx.get(commands)).run()).toBe(0)
  expect(b.mock.requestCount).toBe(1)
})

it("an op's invalid input carries the op's own schema, not the parse-only one", async () => {
  const w = await world(true, ['list', 'console_app', '--limit', '500'])
  const expected = FIXTURE_OPS['list.console_app']?.input
  expect(expected).toMatchObject({ required: ['workspace_id'] })
  expect(propertiesOf(expected ?? {})).not.toHaveProperty('input')
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'input_invalid',
    hint: 'run difyctl help list console_app',
    schema: expected,
  })
})

it('an unreachable catalog costs a notice, not the static suggestion', async () => {
  const w = await world(true, ['versoin'])
  w.mock.setScenario('no-catalog')
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    hint: 'did you mean: version',
  })
  expect(w.io.errBuf().trim().split('\n')).toHaveLength(1)
  expect(w.io.errBuf()).toMatch(/^could not list server operations: failed to fetch the catalog: /)
})

it('without a login only statics resolve and the hint says to log in', async () => {
  const w = await world(false, ['list', 'console_app'])
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: 'unknown command: list console_app',
    hint: 'log in to use server operations',
  })
  expect(w.mock.requestCount).toBe(0)
})

it('a static command resolves without loading the catalog', async () => {
  const w = await world(true, ['version'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.requestCount).toBe(1)
  expect(w.mock.lastRequest?.path).toBe('/openapi/v1/_version')
})

it('invalid input points at the help for the path that failed', async () => {
  const a = await world(false, ['use', 'workspace'])
  await expect((await a.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'input_invalid',
    hint: 'run difyctl help use workspace',
  })
  const b = await world(true, ['describe', 'console_app'])
  await expect((await b.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'input_invalid',
    hint: 'run difyctl help describe console_app',
  })
})
