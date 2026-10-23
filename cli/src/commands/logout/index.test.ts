import type { TestWorld } from '@test/fixtures/kernel'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { INSTALLATION_FILE_NAME } from '@/auth/installation'
import { PENDING_FILE_NAME } from '@/auth/pending-login'
import { Context } from '@/kernel/context'
import { commands } from '@/plugins/commands'
import { LOGIN_FILE_NAME, session } from '@/plugins/session'
import { token } from '@/plugins/token'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

function catalogFiles(dir: string): string[] {
  const catalogDir = join(dir, 'catalog')
  return existsSync(catalogDir) ? readdirSync(catalogDir) : []
}

async function accountLogin(w: TestWorld, sessionId: string | null = 'tok-1'): Promise<void> {
  const sessionService = await w.ctx.get(session)
  const login = await sessionService.require()
  await sessionService.save({
    ...login,
    account: { id: 'acc-1', email: login.email, name: 'Me' },
    sessionId,
  })
}

it('revokes the session on the server and clears local state', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toEqual({
    logged_out: true,
    server: w.mock.url,
    revoked: true,
  })
  expect(w.io.errBuf()).toBe('')

  expect(await (await w.ctx.get(session)).current()).toBeNull()
  expect(catalogFiles(w.dir)).toEqual([])
  await expect((await new Context().get(token)).get()).rejects.toMatchObject({
    code: 'not_logged_in',
  })
})

it('keeps the installation id', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  const installationFile = join(w.dir, INSTALLATION_FILE_NAME)
  writeFileSync(installationFile, 'id: kept-id-1234\n')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(readFileSync(installationFile, 'utf8')).toBe('id: kept-id-1234\n')
})

it('treats a 401 on the revoke as already gone', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  w.mock.setScenario('auth-expired')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.lastRequest).toMatchObject({
    method: 'DELETE',
    path: '/openapi/v1/account/sessions/self',
  })
  expect(w.io.errBuf()).toBe('')
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ revoked: true })
  expect(await (await w.ctx.get(session)).current()).toBeNull()
})

it('drops a pending --no-wait login', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  const pendingFile = join(w.dir, PENDING_FILE_NAME)
  writeFileSync(pendingFile, 'device_code: stale\n')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(existsSync(pendingFile)).toBe(false)
})

it('drops a pending --no-wait login when nobody is logged in', async () => {
  const w = await testContext({ login: false, argv: ['logout'] })
  worlds.push(w)
  const pendingFile = join(w.dir, PENDING_FILE_NAME)
  writeFileSync(pendingFile, 'device_code: stale\n')
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({ code: 'not_logged_in' })
  expect(existsSync(pendingFile)).toBe(false)
})

it('still clears local state and reports a failed server revoke', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  await accountLogin(w)
  w.mock.setScenario('server-5xx')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.io.errBuf()).toMatch(/^server revoke failed:/)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ logged_out: true, revoked: false })
  expect(JSON.parse(w.io.outBuf()).revoke_error).toEqual(expect.any(String))
  expect(JSON.parse(w.io.outBuf()).hints).toEqual([
    {
      summary: 'revoke it from another login',
      op: 'delete.account.session',
      input: { session_id: 'tok-1' },
    },
  ])
  expect(w.io.errBuf()).toContain(
    'revoke it from another login: difyctl delete account session --session-id tok-1',
  )

  expect(await (await w.ctx.get(session)).current()).toBeNull()
  expect(catalogFiles(w.dir)).toEqual([])
  await expect((await new Context().get(token)).get()).rejects.toMatchObject({
    code: 'not_logged_in',
  })
})

it('refuses under an env login', async () => {
  const w = await testContext({ login: false, env: true, argv: ['logout'] })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: 'nothing to log out: the login comes from DIFY_TOKEN',
  })
})

it('refuses under an env login without dropping a pending interactive login', async () => {
  const w = await testContext({ login: false, env: true, argv: ['logout'] })
  worlds.push(w)
  const pendingFile = join(w.dir, PENDING_FILE_NAME)
  writeFileSync(pendingFile, 'device_code: dc-1\n')
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
  })
  expect(existsSync(pendingFile)).toBe(true)
})

it('points to the session list when the login has no session id', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  await accountLogin(w, null)
  w.mock.setScenario('server-5xx')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({
    revoked: false,
    hints: [
      { summary: 'find the id of this session', op: 'get.account.session' },
      { summary: 'revoke it from another login', op: 'delete.account.session' },
    ],
  })
  expect(JSON.parse(w.io.outBuf()).hints[1]).not.toHaveProperty('input')
  expect(w.io.errBuf()).toContain('find the id of this session: difyctl get account session\n')
  expect(w.io.errBuf()).toContain('revoke it from another login: difyctl delete account session\n')
})

it('logs out a login.yml saved without a session id', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  const file = join(w.dir, LOGIN_FILE_NAME)
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^session_id:.*\n/m, ''))
  expect(readFileSync(file, 'utf8')).not.toContain('session_id')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ revoked: true })
  expect(w.io.errBuf()).toBe('')
})

it('gives an external-SSO login no session-command hint when the revoke fails', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  expect((await (await w.ctx.get(session)).require()).account).toBeNull()
  w.mock.setScenario('forbidden')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ logged_out: true, revoked: false, hints: [] })
  expect(w.io.errBuf()).toMatch(/^server revoke failed:/)
  expect(w.io.errBuf()).not.toMatch(/account session/)
  expect(await (await w.ctx.get(session)).current()).toBeNull()
})
