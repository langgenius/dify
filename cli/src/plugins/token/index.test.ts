import type { Login } from '@/plugins/session'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { session } from '@/plugins/session'
import { token } from './index'

const LOGIN: Login = {
  server: 'https://d.example',
  email: 'me@x',
  account: { id: 'a1', email: 'me@x', name: 'Me' },
  workspaceId: null,
  tokenStorage: 'file',
  insecure: false,
}
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'difyctl-tok-'))
  process.env.DIFY_CONFIG_DIR = dir
  process.env.DIFY_E2E_NO_KEYRING = '1'
})
afterEach(() => {
  for (const k of ['DIFY_CONFIG_DIR', 'DIFY_E2E_NO_KEYRING', 'DIFY_SERVER', 'DIFY_TOKEN'])
    delete process.env[k]
})

it('writes, reads and removes through the file store', async () => {
  const ctx = new Context()
  await (await ctx.get(session)).save(LOGIN)
  const t = await ctx.get(token)
  await t.write(LOGIN, 'dfoa_secret')
  expect(await t.get()).toBe('dfoa_secret')
  await t.remove(LOGIN)
  await expect((await new Context().get(token)).get()).rejects.toMatchObject({
    code: 'not_logged_in',
  })
})

it('returns the env token without touching the store', async () => {
  process.env.DIFY_SERVER = 'https://env.example'
  process.env.DIFY_TOKEN = 'dfoa_env'
  expect(await (await new Context().get(token)).get()).toBe('dfoa_env')
})

it('write and remove keep the cached bearer in sync on the same Context', async () => {
  const ctx = new Context()
  await (await ctx.get(session)).save(LOGIN)
  const t = await ctx.get(token)
  await t.write(LOGIN, 'dfoa_first')
  expect(await t.get()).toBe('dfoa_first')
  await t.write(LOGIN, 'dfoa_second')
  expect(await t.get()).toBe('dfoa_second')
  await t.remove(LOGIN)
  await expect(t.get()).rejects.toMatchObject({ code: 'not_logged_in' })
})
