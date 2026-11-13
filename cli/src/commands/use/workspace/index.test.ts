import type { TestWorld } from '@test/fixtures/kernel'
import type { BaseError } from '@/errors/base'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { ExitCode } from '@/errors/codes'
import { commands } from '@/plugins/commands'
import { ENV } from '@/plugins/env'
import { session } from '@/plugins/session'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('pins a workspace the account belongs to and names it', async () => {
  const w = await testContext({ login: true, argv: ['use', 'workspace', 'ws-2'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toEqual({ workspace_id: 'ws-2', name: 'Other' })
  expect(await (await w.ctx.get(session)).workspaceId()).toBe('ws-2')
})

it('describe workspace with no id shows the pinned workspace', async () => {
  const w = await testContext({ login: true, argv: ['describe', 'workspace'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ id: 'ws-1', name: 'Default' })
})

it('refuses a workspace the account does not belong to and keeps the old pin', async () => {
  const w = await testContext({ login: true, argv: ['use', 'workspace', 'ws-9'] })
  worlds.push(w)
  const err = await (await w.ctx.get(commands)).run().catch((e: unknown) => e)
  expect(err).toMatchObject({ message: 'workspace not found' })
  expect((err as BaseError).exit()).toBe(ExitCode.Generic)
  expect(await (await w.ctx.get(session)).workspaceId()).toBe('ws-1')
})

it('refuses under an env login and without a login', async () => {
  const a = await testContext({ login: false, env: true, argv: ['use', 'workspace', 'ws-9'] })
  worlds.push(a)
  await expect((await a.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: 'the login comes from DIFY_TOKEN; set DIFY_WORKSPACE_ID instead',
  })
  const b = await testContext({ login: false, argv: ['use', 'workspace', 'ws-9'] })
  worlds.push(b)
  await expect((await b.ctx.get(commands)).run()).rejects.toMatchObject({ code: 'not_logged_in' })
})

it('refuses an empty workspace id, exit 2, and changes nothing', async () => {
  const w = await testContext({ login: true, argv: ['use', 'workspace', ''] })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'input_invalid',
    details: [expect.objectContaining({ loc: ['workspace_id'] })],
  })
  expect(await (await w.ctx.get(session)).workspaceId()).toBe('ws-1')
})

it('refuses when DIFY_WORKSPACE_ID overrides the pin', async () => {
  const w = await testContext({ login: true, argv: ['use', 'workspace', 'ws-9'] })
  worlds.push(w)
  process.env[ENV.WorkspaceId] = 'ws-9'
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: 'DIFY_WORKSPACE_ID is set; unset it to pin locally',
  })
})
