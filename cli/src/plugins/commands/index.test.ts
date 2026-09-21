import type { TestWorld } from '@test/fixtures/kernel'
import type { CommandTree } from '@/plugins/commands/registry'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { commands, runPipeline } from './index'

const worlds: TestWorld[] = []
async function world(login: boolean, argv: string[]) {
  const w = await testContext({ login, argv })
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('root help prints the map of both sides as pretty JSON and fetches the catalog once', async () => {
  const w = await world(true, [])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const out = JSON.parse(w.io.outBuf())
  expect(out.commands).toMatchObject({ cache: ['clear', 'refresh'], version: [] })
  expect(out.ops.console_app).toMatchObject({ groups: expect.arrayContaining(['chat', 'dsl']) })
  expect(out.ops.console_app.ops).toBeGreaterThan(5)
  expect(w.io.outBuf()).toMatch(/\n {2}"commands"/)
  expect(w.mock.requestCount).toBe(1) // the catalog fetch, nothing else
})

it('root help with no server known prints the static half and says so on stderr', async () => {
  const w = await world(false, [])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const out = JSON.parse(w.io.outBuf())
  expect(out.commands.version).toEqual([])
  expect(out.ops).toBeUndefined()
  expect(w.io.errBuf()).toMatch(/log in to list server operations/)
  expect(w.mock.requestCount).toBe(0)
})

it('root help still prints the static half when the catalog cannot be fetched', async () => {
  const w = await world(true, [])
  w.mock.setScenario('no-catalog')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const out = JSON.parse(w.io.outBuf())
  expect(out.commands.version).toEqual([])
  expect(out.ops).toBeUndefined()
  expect(w.io.errBuf().trim().split('\n')).toHaveLength(1)
  expect(w.io.errBuf()).toMatch(/^could not list server operations: failed to fetch the catalog: /)
})

it('help routes a word to an op descriptor, a namespace listing or a search, and --full is the flat list', async () => {
  const a = await world(true, ['help', 'console_app.workflow.run'])
  await (await a.ctx.get(commands)).run()
  const b = await world(true, ['ops', 'describe', 'console_app.workflow.run'])
  await (await b.ctx.get(commands)).run()
  expect(JSON.parse(a.io.outBuf())).toEqual(JSON.parse(b.io.outBuf()))

  const c = await world(true, ['help', 'workspace'])
  await (await c.ctx.get(commands)).run()
  const ids = JSON.parse(c.io.outBuf()).entries.map(
    (e: { id: string; type: string }) => `${e.type}:${e.id}`,
  )
  expect(ids).toContain('command:workspace list')
  expect(ids).toContain('op:workspace.members.list')
  expect(ids).toEqual([...ids].sort())

  const d = await world(true, ['help', 'chatbot'])
  await (await d.ctx.get(commands)).run()
  expect(JSON.parse(d.io.outBuf()).entries[0]).toMatchObject({
    id: 'console_app.chat.run',
    kind: 'sse',
  })
  const e = await world(true, ['help', 'zebra'])
  await (await e.ctx.get(commands)).run()
  expect(JSON.parse(e.io.outBuf())).toEqual({ entries: [], total: 0 })
  expect(e.io.errBuf().trim()).toBe('nothing matched; run difyctl help for the map')

  const f = await world(true, ['help', '--full', '--all'])
  await (await f.ctx.get(commands)).run()
  const full = JSON.parse(f.io.outBuf())
  expect(full.commands[0]).toHaveProperty('usage')
  expect(full.ops.map((o: { id: string }) => o.id)).toContain('workspace.switch')
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

it('root help reuses a cached catalog instead of fetching again', async () => {
  const w = await world(true, [])
  await (await w.ctx.get(commands)).run()
  expect(w.mock.requestCount).toBe(1)
  const reusing = await testContext({ login: true, argv: [], reuseDirOf: w })
  worlds.push(reusing)
  await (await reusing.ctx.get(commands)).run()
  expect(Object.keys(JSON.parse(reusing.io.outBuf()).ops).length).toBeGreaterThan(2)
  expect(reusing.mock.requestCount).toBe(1)
})
