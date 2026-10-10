import type { TestWorld } from '@test/fixtures/kernel'
import type { CatalogOp } from '@/plugins/catalog'
import type { CommandEffect } from '@/plugins/commands/command'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { callOptionsSchema } from '@/call/flags'
import { parseArgv } from '@/plugins/argv/parse'
import { parseCatalog } from '@/plugins/catalog'
import { propertiesOf } from '@/protocol/shape'
import { effectOf, opCommand } from './command'

const OPS = parseCatalog(
  readFileSync(join(__dirname, '../../../test/fixtures/catalog-v2.json')),
).ops

function fixtureOp(id: string): CatalogOp {
  const op = OPS[id]
  if (op === undefined) throw new Error(`catalog-v2 has no op ${id}`)
  return op
}

const list = fixtureOp('get.console_app')

const worlds: TestWorld[] = []
async function world() {
  const w = await testContext({ login: true })
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

const NO_PATH: readonly string[] = []

it('presents an op through the command interface', () => {
  const Ctor = opCommand('get.console_app', list)
  expect(Ctor.summary).toBe(list.summary)
  expect(Ctor.effect).toBe('read')
  expect(Ctor.positional).toEqual([])
  expect(Ctor.examples).toEqual(list.examples)
  expect(Ctor.schema()).toBe(list.input)
  expect(Ctor.facets()).toMatchObject({
    op: 'get.console_app',
    method: 'GET',
    path: '/openapi/v1/apps',
    kind: 'list',
    deprecated: false,
  })
  const flags = Ctor.flags()
  expect(Object.keys(flags.properties as object)).toEqual(
    expect.arrayContaining(['limit', 'mode', 'input']),
  )
  expect(flags.required).toBeUndefined()
  expect(Ctor.finalize({ limit: 5 }, NO_PATH)).toEqual({ limit: 5 })
})

it('a reserved name in the catalog is dropped from the flag schema', () => {
  const Ctor = opCommand('x.y', {
    ...list,
    input: { type: 'object', properties: { input: { type: 'string' }, ok: { type: 'string' } } },
  })
  expect(Object.keys(Ctor.flags().properties as object)).toEqual(['ok', 'input'])
})

it('a reserved name reaches the request body through --input', async () => {
  const w = await world()
  const id = 'run.console_app.workflow'
  const run = fixtureOp(id)
  const Ctor = opCommand(id, {
    ...run,
    input: {
      ...run.input,
      properties: { ...propertiesOf(run.input), input: { type: 'string' } },
    },
  })
  // The only `input` the parser knows is the CLI's own flag; the op's field is not there.
  expect(propertiesOf(Ctor.flags()).input).toEqual(propertiesOf(callOptionsSchema(run.kind)).input)

  const typed = parseArgv(['--input', '{"app_id":"app-2","inputs":{},"input":"kept"}'], {
    positional: Ctor.positional,
    schema: Ctor.flags(),
  })
  await new Ctor().run(Ctor.finalize(typed, NO_PATH), w.ctx)
  expect(w.mock.lastRunBody).toMatchObject({ input: 'kept' })
})

const EFFECTS: readonly [string, CommandEffect | undefined][] = [
  ['GET', 'read'],
  ['DELETE', 'destructive'],
  ['POST', 'write'],
  ['patch', 'write'],
  ['BREW', undefined],
]

it.each(EFFECTS)('effect of %s is %s', (method, effect) => {
  expect(effectOf(method)).toBe(effect)
})

it('help shows the business schema, the op facets, the call options and the pin', async () => {
  const w = await world()
  const row = await opCommand('get.console_app', list).help({
    path: ['get', 'console_app'],
    rest: [],
    ctx: w.ctx,
  })
  expect(row).toMatchObject({
    id: 'get console_app',
    usage: 'difyctl get console_app [flags]',
    summary: list.summary,
    effect: 'read',
    op: 'get.console_app',
    method: 'GET',
    path: '/openapi/v1/apps',
    kind: 'list',
    deprecated: false,
    pins: { workspace_id: 'ws-1' },
  })
  expect(row.input).toMatchObject({ required: ['workspace_id'] })
  expect(Object.keys((row.options as { properties: object }).properties)).toEqual(['input'])
})

it('runs the op from its own flags, pinning the workspace', async () => {
  const w = await world()
  const Ctor = opCommand('get.console_app', list)
  const input = parseArgv(['--limit', '2'], { positional: Ctor.positional, schema: Ctor.flags() })
  const out = await new Ctor().run(Ctor.finalize(input, NO_PATH), w.ctx)
  expect(out).toMatchObject({ code: 0 })
  expect(w.mock.lastRequest?.path).toBe('/openapi/v1/apps?limit=2&workspace_id=ws-1')
})

it('help omits pins for an op whose schema takes no workspace_id', async () => {
  const w = await world()
  const row = await opCommand('describe.account', fixtureOp('describe.account')).help({
    path: ['describe', 'account'],
    rest: [],
    ctx: w.ctx,
  })
  expect(row).not.toHaveProperty('pins')
})
