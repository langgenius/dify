import type { Login } from './index'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { session } from './index'

const LOGIN: Login = {
  server: 'https://d.example',
  email: 'me@x',
  account: { id: 'a1', email: 'me@x', name: 'Me' },
  workspaceId: 'ws-1',
  tokenStorage: 'file',
  insecure: false,
}
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'difyctl-sess-'))
  process.env.DIFY_CONFIG_DIR = dir
})
afterEach(() => {
  for (const k of ['DIFY_CONFIG_DIR', 'DIFY_SERVER', 'DIFY_TOKEN', 'DIFY_WORKSPACE_ID'])
    delete process.env[k]
})

it('is null before login and require() exits 4', async () => {
  const s = await new Context().get(session)
  expect(await s.current()).toBeNull()
  await expect(s.require()).rejects.toMatchObject({ code: 'not_logged_in' })
})

it('save / current / clear round-trip', async () => {
  const s = await new Context().get(session)
  await s.save(LOGIN)
  expect(await s.current()).toEqual(LOGIN)
  await s.save({ ...LOGIN, workspaceId: 'ws-2' })
  expect(await s.workspaceId()).toBe('ws-2')
  await s.clear()
  expect(await s.current()).toBeNull()
})

it('env login wins, never touches disk, and refuses save', async () => {
  process.env.DIFY_SERVER = 'https://env.example'
  process.env.DIFY_TOKEN = 'dfoa_env'
  process.env.DIFY_WORKSPACE_ID = 'ws-env'
  const s = await new Context().get(session)
  expect(s.fromEnv).toBe(true)
  expect((await s.require()).server).toBe('https://env.example')
  expect(await s.workspaceId()).toBe('ws-env')
  await expect(s.save(LOGIN)).rejects.toMatchObject({ code: 'usage_invalid_flag' })
})

it('DIFY_SERVER without a token is not a login', async () => {
  process.env.DIFY_SERVER = 'https://env.example'
  const s = await new Context().get(session)
  expect(s.fromEnv).toBe(false)
  expect(await s.current()).toBeNull()
  await s.save(LOGIN)
  expect(await s.current()).toEqual(LOGIN)
})

it('DIFY_WORKSPACE_ID overrides the pin', async () => {
  await (await new Context().get(session)).save(LOGIN)
  process.env.DIFY_WORKSPACE_ID = 'ws-env'
  expect(await (await new Context().get(session)).workspaceId()).toBe('ws-env')
})
