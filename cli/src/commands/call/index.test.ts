import type { TestWorld } from '@test/fixtures/kernel'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

it('fills the pin, validates, sends the fingerprint and prints a list with the server hint', async () => {
  const w = await world(['call', 'console_app.list', '--input', '{"limit":1}'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.lastRequest?.path).toBe('/openapi/v1/apps?limit=1&workspace_id=ws-1')
  expect(w.mock.lastRequest?.headers['x-dify-catalog']).toHaveLength(64)
  expect(JSON.parse(w.io.outBuf()).hints[0]).toMatchObject({
    op: 'console_app.list',
    input: { workspace_id: 'ws-1', limit: 1, page: 2 },
  })
})

it('rejects invalid input with details and the schema, exit 2, before any op request', async () => {
  const w = await world(['call', 'console_app.describe', '--input', '{}'])
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'input_invalid',
    details: [{ type: 'required', loc: ['app_id'] }],
    schema: expect.objectContaining({ type: 'object' }),
  })
  expect(w.mock.requestCount).toBe(1) // only the first-run catalog fetch
})

it('refuses --stream on a non-sse op, exit 2', async () => {
  const w = await world([
    'call',
    'console_app.describe',
    '--input',
    '{"app_id":"app-1"}',
    '--stream',
  ])
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: expect.stringContaining('--stream'),
  })
})

it('refuses --only without --stream, exit 2, before any op request', async () => {
  const w = await world([
    'call',
    'console_app.workflow.run',
    '--input',
    '{"app_id":"app-2","inputs":{}}',
    '--only',
    'workflow_finished',
  ])
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: '--only requires --stream',
  })
  expect(w.mock.requestCount).toBe(1) // only the first-run catalog fetch
})

it('warns once on stderr for a deprecated op and still runs it', async () => {
  const w = await world([
    'call',
    'console_app.run',
    '--input',
    '{"app_id":"app-1","inputs":{},"query":"hi"}',
  ])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.io.errBuf().trim()).toBe('deprecated: console_app.run')
  expect(JSON.parse(w.io.outBuf())).toMatchObject({
    status: 'ended',
    text: { answer: 'echo: hi' },
  })
})

it('folds a per-mode run and copies the reply hint', async () => {
  const w = await world([
    'call',
    'console_app.chat.run',
    '--input',
    '{"app_id":"app-1","inputs":{},"query":"hi"}',
  ])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({
    status: 'ended',
    text: { answer: 'echo: hi' },
    conversation_id: 'conv-1',
    hints: [{ op: 'console_app.chat.run', input: { conversation_id: 'conv-1', query: null } }],
  })
})

it('streams with --stream --only', async () => {
  const w = await world([
    'call',
    'console_app.workflow.run',
    '--input',
    '{"app_id":"app-2","inputs":{}}',
    '--stream',
    '--only',
    'workflow_finished',
  ])
  await (await w.ctx.get(commands)).run()
  const lines = w.io
    .outBuf()
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  expect(lines).toHaveLength(1)
  expect(lines[0].event).toBe('workflow_finished')
})

it('sends multipart when files are given', async () => {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  const tmp = join(seed.dir, 'r.pdf')
  writeFileSync(tmp, 'pdf')
  const w = await testContext({
    login: true,
    argv: [
      'call',
      'console_app.workflow.run',
      '--input',
      JSON.stringify({ app_id: 'app-2', inputs: {}, files: { doc: tmp } }),
    ],
    reuseDirOf: seed,
  })
  worlds.push(w)
  await (await w.ctx.get(commands)).run()
  expect(w.mock.lastRequest?.contentType).toMatch(/^multipart\/form-data/)
  expect(w.mock.lastRunParts?.['files[doc]']).toHaveLength(1)
})

it('a paused run is exit 0 with status suspended and the server hints', async () => {
  const w = await world([
    'call',
    'console_app.workflow.run',
    '--input',
    '{"app_id":"app-2","inputs":{}}',
  ])
  w.mock.setScenario('hitl-pause')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({
    status: 'suspended',
    hints: [{ op: 'run.form.submit', input: { form_token: 'ft-hitl-1', action: 'submit' } }],
  })
})

it('a stale catalog is refreshed once and the op is retried; an unknown op is exit 6', async () => {
  const w = await world(['ops'])
  await (await w.ctx.get(commands)).run()
  w.mock.setScenario('catalog-changed')
  const w2 = await testContext({
    login: true,
    argv: ['call', 'workspace.ping', '--input', '{"workspace_id":"ws-1"}'],
    reuseDirOf: w,
  })
  worlds.push(w2)
  expect(await (await w2.ctx.get(commands)).run()).toBe(0)
  const w3 = await testContext({ login: true, argv: ['call', 'nope.op'], reuseDirOf: w })
  worlds.push(w3)
  await expect((await w3.ctx.get(commands)).run()).rejects.toMatchObject({ code: 'unknown_op' })
})

it('call <op> --help prints the same row as ops describe', async () => {
  const a = await world(['call', 'console_app.workflow.run', '--help'])
  await (await a.ctx.get(commands)).run()
  const help = JSON.parse(a.io.outBuf())
  const b = await world(['ops', 'describe', 'console_app.workflow.run'])
  await (await b.ctx.get(commands)).run()
  expect(help).toEqual(JSON.parse(b.io.outBuf()))
  expect(help).toMatchObject({
    id: 'console_app.workflow.run',
    kind: 'sse',
    usage: expect.stringContaining('difyctl call console_app.workflow.run'),
    pins: { workspace_id: 'ws-1' },
    examples: [],
  })
})

it('call --help with no op named prints the command row and fetches nothing', async () => {
  const w = await world(['call', '--help'])
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({
    id: 'call',
    usage: 'difyctl call <op_id> [options]',
    effect: 'write',
  })
  expect(w.mock.requestCount).toBe(0)
})

it('a stream that dies mid-run folds as incomplete, exit 0, with one stderr notice', async () => {
  const w = await world([
    'call',
    'console_app.chat.run',
    '--input',
    '{"app_id":"app-1","inputs":{},"query":"hi"}',
  ])
  w.mock.setScenario('broken-stream')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({
    status: 'incomplete',
    text: { answer: 'partial' },
  })
  expect(w.io.errBuf().trim().split('\n')).toHaveLength(1)
  expect(w.io.errBuf()).toMatch(/^stream ended early: /)
})

it('registers the stream abort as a deferred cleanup', async () => {
  const w = await world([
    'call',
    'console_app.workflow.run',
    '--input',
    '{"app_id":"app-2","inputs":{}}',
  ])
  await (await w.ctx.get(commands)).run()
  expect(w.ctx.deferred).toHaveLength(1)
})
