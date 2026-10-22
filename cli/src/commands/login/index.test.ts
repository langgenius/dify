import type { TestWorld } from '@test/fixtures/kernel'
import type { TokenService } from '@/plugins/token'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { INSTALLATION_FILE_NAME } from '@/auth/installation'
import { PENDING_FILE_NAME } from '@/auth/pending-login'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { Context } from '@/kernel/context'
import { commands } from '@/plugins/commands'
import { LOGIN_FILE_NAME, session } from '@/plugins/session'
import { token } from '@/plugins/token'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('logs the previous login out, runs the device flow, saves the pin and the token', async () => {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  const w = await testContext({
    login: true,
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--no-keyring', '--insecure'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.io.errBuf()).toMatch(/logged out me@x from/)
  expect(w.io.errBuf()).toMatch(/code ABCD-1234/)
  const login = await (await w.ctx.get(session)).current()
  expect(login?.workspaceId).toBe('ws-1')
  expect(login?.tokenStorage).toBe('file')
  expect(await (await w.ctx.get(token)).get()).toBe('dfoa_test')
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ server: w.mock.url, workspace_id: 'ws-1' })
})

it('refuses under an env login', async () => {
  const seed = await testContext({ login: false, env: true })
  worlds.push(seed)
  const w = await testContext({
    login: false,
    env: true,
    argv: ['login', '--server', seed.mock.url],
    reuseDirOf: seed,
  })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: 'unset DIFY_TOKEN to log in interactively',
  })
})

it('checks the verification uri before inviting the operator to open it', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const w = await testContext({
    login: false,
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--no-keyring', '--insecure'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  w.mock.setScenario('bad-verification-uri')
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'unknown',
    message: expect.stringContaining('unsupported scheme "ftp"'),
  })
  expect(w.io.errBuf()).not.toMatch(/open /)
  expect(w.io.errBuf()).not.toMatch(/code ABCD-1234/)
})

it('rejects a login response with no usable email and saves nothing', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const w = await testContext({
    login: false,
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--no-keyring', '--insecure'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  w.mock.setScenario('no-email')
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'server_error',
    message: 'login response carries no account or subject email',
  })
  expect(await (await w.ctx.get(session)).current()).toBeNull()
})

it('falls back to the external-SSO subject email when there is no account', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const w = await testContext({
    login: false,
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--no-keyring', '--insecure'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  w.mock.setScenario('sso')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const login = await (await w.ctx.get(session)).current()
  expect(login?.email).toBe('sso@dify.ai')
  expect(login?.account).toBeNull()
  expect(login?.sessionId).toBe('tok-sso-1')
  expect(readFileSync(join(w.dir, LOGIN_FILE_NAME), 'utf8')).toContain('session_id: tok-sso-1')
})

it('resume with no pending login reports the saved login', async () => {
  const w = await testContext({ login: true, argv: ['login', '--resume'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({
    server: w.mock.url,
    email: 'me@x',
    workspace_id: 'ws-1',
  })
})

it('resume with no pending login and no saved login is not_logged_in', async () => {
  const w = await testContext({ login: false, argv: ['login', '--resume'] })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'not_logged_in',
    message: `not logged in: no login saved in ${w.dir}; DIFY_CONFIG_DIR picks this folder`,
  })
})

it('resume with no pending login and the token gone is not_logged_in', async () => {
  const w = await testContext({ login: true, argv: ['login', '--resume'] })
  worlds.push(w)
  const fresh = new Context()
  const login = await (await fresh.get(session)).require()
  await (await fresh.get(token)).remove(login)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({ code: 'not_logged_in' })
})

it('resume under an env login reports the env login', async () => {
  const w = await testContext({ login: false, env: true, argv: ['login', '--resume'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ server: w.mock.url, email: 'env' })
})

it('a new login drops a pending --no-wait login', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const pendingFile = join(seed.dir, PENDING_FILE_NAME)
  writeFileSync(
    pendingFile,
    `server: ${seed.mock.url}\ninsecure: true\nno_keyring: true\ndevice_code: stale\n`,
  )
  const w = await testContext({
    login: false,
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--no-keyring', '--insecure'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(existsSync(pendingFile)).toBe(false)
})

it.each([[[]], [['--server', '  ']]])(
  'refuses to start without a server, keeping a pending login',
  async (flags) => {
    const seed = await testContext({ login: false })
    worlds.push(seed)
    const pendingPath = join(seed.dir, PENDING_FILE_NAME)
    writeFileSync(
      pendingPath,
      `server: ${seed.mock.url}\ninsecure: true\nno_keyring: true\ndevice_code: kept\n`,
    )
    const w = await testContext({
      login: false,
      argv: ['login', '--no-wait', ...flags],
      reuseDirOf: seed,
    })
    worlds.push(w)
    await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
      code: 'usage_missing_arg',
      hint: 'ask the user which server; Dify Cloud is https://cloud.dify.ai',
    })
    expect(existsSync(pendingPath)).toBe(true)
  },
)

it('keeps a pending login when the new --server is rejected', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const pendingPath = join(seed.dir, PENDING_FILE_NAME)
  writeFileSync(
    pendingPath,
    `server: ${seed.mock.url}\ninsecure: true\nno_keyring: true\ndevice_code: kept\n`,
  )
  const w = await testContext({
    login: false,
    argv: ['login', '--server', 'http://plain.example.com', '--no-wait'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
  })
  expect(existsSync(pendingPath)).toBe(true)
})

it('resume under an env login refuses a pending login before polling', async () => {
  const seed = await testContext({ login: false, env: true })
  worlds.push(seed)
  const pendingPath = join(seed.dir, PENDING_FILE_NAME)
  writeFileSync(
    pendingPath,
    `server: ${seed.mock.url}\ninsecure: true\nno_keyring: true\ndevice_code: kept\n`,
  )
  const w = await testContext({
    login: false,
    env: true,
    argv: ['login', '--resume'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'usage_invalid_flag',
    message: 'unset DIFY_TOKEN to log in interactively',
  })
  expect(existsSync(pendingPath)).toBe(true)
})

it.each(['happy', 'denied', 'expired'] as const)(
  'resume (%s) leaves a pending login another process saved meanwhile',
  async (scenario) => {
    const seed = await testContext({ login: false })
    worlds.push(seed)
    const pendingPath = join(seed.dir, PENDING_FILE_NAME)
    const pendingFor = (code: string) =>
      `server: ${seed.mock.url}\ninsecure: true\nno_keyring: true\ndevice_code: ${code}\n`
    writeFileSync(pendingPath, pendingFor('dc-1'))
    seed.mock.setScenario(scenario)
    seed.mock.onDeviceTokenPoll(() => writeFileSync(pendingPath, pendingFor('dc-2')))
    const w = await testContext({ login: false, argv: ['login', '--resume'], reuseDirOf: seed })
    worlds.push(w)

    await (await w.ctx.get(commands)).run().catch(() => undefined)

    expect(readFileSync(pendingPath, 'utf8')).toContain('device_code: dc-2')
  },
)

it.each(['happy', 'denied', 'expired'] as const)(
  'resume (%s) clears its own pending login',
  async (scenario) => {
    const seed = await testContext({ login: false })
    worlds.push(seed)
    const pendingPath = join(seed.dir, PENDING_FILE_NAME)
    writeFileSync(
      pendingPath,
      `server: ${seed.mock.url}\ninsecure: true\nno_keyring: true\ndevice_code: dc-1\n`,
    )
    seed.mock.setScenario(scenario)
    const w = await testContext({ login: false, argv: ['login', '--resume'], reuseDirOf: seed })
    worlds.push(w)

    await (await w.ctx.get(commands)).run().catch(() => undefined)

    expect(existsSync(pendingPath)).toBe(false)
  },
)

const LOGIN_FLAGS = ['--no-browser', '--no-keyring', '--insecure'] as const

async function loginWorld(server: string, reuseDirOf: TestWorld): Promise<TestWorld> {
  const w = await testContext({
    login: false,
    argv: ['login', '--server', server, ...LOGIN_FLAGS],
    reuseDirOf,
  })
  worlds.push(w)
  return w
}

async function loggedInWorld(): Promise<TestWorld> {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const first = await loginWorld(seed.mock.url, seed)
  expect(await (await first.ctx.get(commands)).run()).toBe(0)
  return seed
}

it('login sends installation_id and hostname label', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const w = await loginWorld(seed.mock.url, seed)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const body = w.mock.lastDeviceCodeBody
  expect(body?.device_label).toBe(hostname())
  expect(readFileSync(join(w.dir, INSTALLATION_FILE_NAME), 'utf8')).toBe(
    `id: ${String(body?.installation_id)}\n`,
  )
})

it.each([
  ['denied', 'access_denied'],
  ['expired', 'auth_expired'],
] as const)('an abandoned login (%s) leaves the saved login alone', async (scenario, code) => {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  seed.mock.setScenario(scenario)
  const w = await loginWorld(seed.mock.url, seed)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({ code })
  expect(w.mock.sessionRevokeCount).toBe(0)
  expect(w.io.errBuf()).not.toMatch(/logged out/)
  expect((await (await new Context().get(session)).current())?.email).toBe('me@x')
  expect(await (await new Context().get(token)).get()).toBe('dfoa_file')
})

it('login --no-wait leaves the saved login alone', async () => {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  const w = await testContext({
    login: false,
    argv: ['login', '--server', seed.mock.url, '--no-wait', ...LOGIN_FLAGS],
    reuseDirOf: seed,
  })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.sessionRevokeCount).toBe(0)
  expect((await (await new Context().get(session)).current())?.email).toBe('me@x')
  expect(await (await new Context().get(token)).get()).toBe('dfoa_file')
})

it('a relogin on the same install revokes the previous session', async () => {
  const seed = await loggedInWorld()
  const w = await loginWorld(seed.mock.url, seed)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.sessionRevokeCount).toBe(1)
  expect(w.io.errBuf()).toMatch(/logged out tester@dify\.ai from/)
  expect(await (await w.ctx.get(token)).get()).toBe('dfoa_test')
})

it('a relogin whose previous session the server already rotated (401) stays quiet and saves the new login', async () => {
  const seed = await loggedInWorld()
  seed.mock.setScenario('auth-expired')
  const w = await loginWorld(seed.mock.url, seed)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.lastRequest).toMatchObject({
    method: 'DELETE',
    path: '/openapi/v1/account/sessions/self',
  })
  expect(w.io.errBuf()).not.toMatch(/server revoke failed/)
  expect(w.io.errBuf()).toMatch(/logged out tester@dify\.ai from/)
  expect((await (await new Context().get(session)).current())?.email).toBe('tester@dify.ai')
  expect(await (await new Context().get(token)).get()).toBe('dfoa_test')
})

it('a 403 on the previous session revoke is reported, not taken as gone', async () => {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  seed.mock.setScenario('forbidden')
  const w = await loginWorld(seed.mock.url, seed)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.io.errBuf()).toMatch(/server revoke failed: /)
  expect((await (await new Context().get(session)).current())?.email).toBe('tester@dify.ai')
})

it('an external-SSO login after an account login revokes the account session', async () => {
  const seed = await loggedInWorld()
  seed.mock.setScenario('sso')
  const w = await loginWorld(seed.mock.url, seed)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.sessionRevokeCount).toBe(1)
  expect((await (await w.ctx.get(session)).current())?.email).toBe('sso@dify.ai')
})

it('a login to another server revokes the old session on the old server', async () => {
  const other = await testContext({ login: false })
  worlds.push(other)
  const seed = await loggedInWorld()
  const w = await loginWorld(other.mock.url, seed)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(seed.mock.sessionRevokeCount).toBe(1)
  expect(other.mock.sessionRevokeCount).toBe(0)
  expect((await (await w.ctx.get(session)).current())?.server).toBe(other.mock.url)
})

it('keeps the new login when the previous one cannot be cleared locally', async () => {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  const w = await loginWorld(seed.mock.url, seed)
  const real = await new Context().get(token)
  const lockedKeyring: TokenService = {
    ...real,
    remove: async () => {
      throw new BaseError({ code: ErrorCode.KeyringUnavailable, message: 'keyring is locked' })
    },
  }
  const ctx = new Context([...w.overrides, [token, lockedKeyring]])
  expect(await (await ctx.get(commands)).run()).toBe(0)
  expect(w.mock.sessionRevokeCount).toBe(1)
  expect(w.io.errBuf()).toMatch(/could not clear the previous login: keyring is locked/)
  expect(w.io.errBuf()).not.toMatch(/logged out/)
  expect((await (await new Context().get(session)).current())?.email).toBe('tester@dify.ai')
  expect(await (await new Context().get(token)).get()).toBe('dfoa_test')
})

it('resume revokes the saved login only once the pending login succeeds', async () => {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  writeFileSync(
    join(seed.dir, PENDING_FILE_NAME),
    `server: ${seed.mock.url}\ninsecure: true\nno_keyring: true\ndevice_code: dc-1\n`,
  )
  const w = await testContext({ login: false, argv: ['login', '--resume'], reuseDirOf: seed })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.mock.sessionRevokeCount).toBe(1)
  expect((await (await w.ctx.get(session)).current())?.email).toBe('tester@dify.ai')
})
