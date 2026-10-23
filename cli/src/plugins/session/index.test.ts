import type { Login } from './index'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { io, ioService } from '@/plugins/io'
import { bufferStreams } from '@/sys/io/streams'
import { LOGIN_FILE_NAME, session } from './index'

const LOGIN: Login = {
  server: 'https://d.example',
  email: 'me@x',
  account: { id: 'a1', email: 'me@x', name: 'Me' },
  workspaceId: 'ws-1',
  tokenStorage: 'file',
  insecure: false,
  sessionId: 'tok-1',
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

function withLoginFile(content: string) {
  writeFileSync(join(dir, LOGIN_FILE_NAME), content)
  const streams = bufferStreams()
  return { streams, load: () => new Context([[io, ioService(streams)]]).get(session) }
}

it.each([
  ['server', 'email: me@x\ntoken_storage: file\n'],
  ['email', 'server: https://d.example\ntoken_storage: file\n'],
])('reads a login.yml without %s as logged out, with one notice', async (key, content) => {
  const { streams, load } = withLoginFile(content)
  const s = await load()
  expect(await s.current()).toBeNull()
  expect(await s.current()).toBeNull()
  expect(streams.errBuf()).toMatch(new RegExp(`has no valid ${key}; ignoring it\n$`))
  await s.save(LOGIN)
  expect(await s.current()).toEqual(LOGIN)
})

it('reads a login.yml with only its identity, defaulting the rest and ignoring unknown keys', async () => {
  const { streams, load } = withLoginFile(
    'schema_version: 99\nfuture_key: x\nserver: https://d.example\nemail: me@x\ntoken_storage: file\ninsecure: maybe\n',
  )
  expect(await (await load()).current()).toEqual({
    server: 'https://d.example',
    email: 'me@x',
    account: null,
    workspaceId: null,
    tokenStorage: 'file',
    insecure: false,
    sessionId: null,
  })
  expect(streams.errBuf()).toMatch(/ignoring the invalid value of insecure\n$/)
})

it('saves only the current shape', async () => {
  const { load } = withLoginFile('future_key: x\n')
  await (await load()).save(LOGIN)
  expect(readFileSync(join(dir, LOGIN_FILE_NAME), 'utf8')).not.toContain('future_key')
})
