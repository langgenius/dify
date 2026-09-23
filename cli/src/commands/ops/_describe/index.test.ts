// Skipped: `ops describe` moved out of the tree; see docs/superpowers/specs/2026-09-22-difyctl-v2-human-output-design.md
import type { TestWorld } from '@test/fixtures/kernel'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'

const worlds: TestWorld[] = []
async function world(argv: string[]) {
  const w = await testContext({ login: true, argv })
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})
const printed = (w: TestWorld) => JSON.parse(w.io.outBuf())

it.skip('prints the catalog fields with a call usage line and the pinned workspace', async () => {
  const w = await world(['ops', 'describe', 'console_app.list'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(printed(w)).toMatchObject({
    id: 'console_app.list',
    usage: 'difyctl call console_app.list --input <json|@file|@->',
    kind: 'list',
    method: 'GET',
    path: '/openapi/v1/apps',
    deprecated: false,
    pins: { workspace_id: 'ws-1' },
  })
  expect(printed(w).input).toMatchObject({ type: 'object', required: ['workspace_id'] })
  expect(w.mock.requestCount).toBe(1)
})

it.skip('omits pins for an op whose schema takes no workspace_id', async () => {
  const w = await world(['ops', 'describe', 'account.get'])
  await (await w.ctx.get(commands)).run()
  expect(printed(w)).not.toHaveProperty('pins')
})

it.skip('refreshes a stale catalog once for an op it has not seen', async () => {
  const w = await world(['ops'])
  await (await w.ctx.get(commands)).run()
  w.mock.setScenario('catalog-changed')
  const w2 = await testContext({
    login: true,
    argv: ['ops', 'describe', 'workspace.ping'],
    reuseDirOf: w,
  })
  worlds.push(w2)
  expect(await (await w2.ctx.get(commands)).run()).toBe(0)
  expect(printed(w2)).toMatchObject({ id: 'workspace.ping', kind: 'object', examples: [] })
})

// The catalog-v2 fixture's workspace.ping carries its own `id` and `usage` keys.
it.skip('keeps the CLI id and usage when the catalog op carries those keys', async () => {
  const w = await world(['ops'])
  await (await w.ctx.get(commands)).run()
  w.mock.setScenario('catalog-changed')
  const w2 = await testContext({
    login: true,
    argv: ['ops', 'describe', 'workspace.ping'],
    reuseDirOf: w,
  })
  worlds.push(w2)
  await (await w2.ctx.get(commands)).run()
  expect(printed(w2)).toMatchObject({
    id: 'workspace.ping',
    usage: 'difyctl call workspace.ping --input <json|@file|@->',
  })
})

it.skip('an unknown op is unknown_op with the ops hint', async () => {
  const w = await world(['ops', 'describe', 'nope.op'])
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'unknown_op',
    hint: 'run difyctl ops',
  })
})
