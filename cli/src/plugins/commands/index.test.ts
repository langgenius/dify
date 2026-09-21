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

it('root help lists the command rows as pretty JSON and fetches the catalog for the ops rows', async () => {
  const w = await world(true, [])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const out = JSON.parse(w.io.outBuf())
  expect(out.commands.map((c: { id: string }) => c.id)).toContain('version')
  expect(out.ops.map((o: { id: string }) => o.id)).toContain('console_app.workflow.run')
  expect(w.io.outBuf()).toMatch(/\n {2}"commands"/)
  expect(w.mock.requestCount).toBe(1) // the catalog fetch, nothing else
})

it('root help with no server known prints the static rows and says so on stderr', async () => {
  const w = await world(false, [])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const out = JSON.parse(w.io.outBuf())
  expect(out.commands.map((c: { id: string }) => c.id)).toContain('version')
  expect(out.ops).toBeUndefined()
  expect(w.io.errBuf()).toMatch(/log in to list server operations/)
  expect(w.mock.requestCount).toBe(0)
})

it('root help still prints the command rows when the ops cannot be listed', async () => {
  const w = await world(true, [])
  w.mock.setScenario('no-catalog')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const out = JSON.parse(w.io.outBuf())
  expect(out.commands.map((c: { id: string }) => c.id)).toContain('version')
  expect(out.ops).toBeUndefined()
  expect(w.io.errBuf().trim().split('\n')).toHaveLength(1)
  expect(w.io.errBuf()).toMatch(/^could not list server operations: failed to fetch the catalog: /)
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

it('applies the schema defaults before run', async () => {
  const w = await world(false, ['fake'])
  expect(await runPipeline(fakeTree, w.ctx)).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toEqual({ dry_run: false })
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
  expect(JSON.parse(reusing.io.outBuf()).ops.length).toBeGreaterThan(20)
  expect(reusing.mock.requestCount).toBe(1)
})
