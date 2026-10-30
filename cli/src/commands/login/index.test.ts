import type { TestWorld } from '@test/fixtures/kernel'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import {
  DEVICE_LABEL_HOSTNAME_MAX,
  DEVICE_LABEL_ID_LENGTH,
  installationId,
} from '@/auth/installation'
import { withLoginFlowLock } from '@/auth/login-flow-lock'
import { PENDING_FILE_NAME } from '@/auth/pending-login'
import { Context } from '@/kernel/context'
import { commands } from '@/plugins/commands'
import { LOGIN_FILE_NAME, session } from '@/plugins/session'
import { token } from '@/plugins/token'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('with --force, logs the previous login out, runs the device flow, saves the pin and the token', async () => {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  const w = await testContext({
    login: true,
    argv: [
      'login',
      '--server',
      seed.mock.url,
      '--no-browser',
      '--no-keyring',
      '--insecure',
      '--force',
    ],
    reuseDirOf: seed,
  })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.io.errBuf()).toMatch(/logged out me@x from/)
  expect(w.io.errBuf()).toMatch(/code ABCD-1234/)
  expect(w.io.errBuf()).toContain(`open ${w.mock.url}/device?user_code=ABCD-1234`)
  const login = await (await w.ctx.get(session)).current()
  expect(login?.workspaceId).toBe('ws-1')
  expect(login?.tokenStorage).toBe('file')
  expect(await (await w.ctx.get(token)).get()).toBe('dfoa_test')
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ server: w.mock.url, workspace_id: 'ws-1' })
})

async function reloginWorld(...extra: string[]): Promise<TestWorld> {
  const seed = await testContext({ login: true })
  worlds.push(seed)
  const w = await testContext({
    login: true,
    argv: [
      'login',
      '--server',
      seed.mock.url,
      '--no-browser',
      '--no-keyring',
      '--insecure',
      ...extra,
    ],
    reuseDirOf: seed,
  })
  worlds.push(w)
  return w
}

it.each([
  ['external-SSO', null],
  ['account', { id: 'acc-1', email: 'me@x', name: 'Me' }],
] as const)('keeps a working %s login instead of starting a new one', async (_kind, account) => {
  const w = await reloginWorld()
  const sessionService = await w.ctx.get(session)
  await sessionService.save({ ...(await sessionService.require()), account })

  expect(await (await w.ctx.get(commands)).run()).toBe(0)

  expect(w.mock.lastDeviceCodeBody).toBeNull()
  expect(w.io.errBuf()).toContain('already logged in as me@x; pass --force to log in again')
  expect(JSON.parse(w.io.outBuf())).toMatchObject({ server: w.mock.url, email: 'me@x' })
  expect(await (await w.ctx.get(token)).get()).toBe('dfoa_file')
})

it('starts a new login when the saved token no longer works', async () => {
  const w = await reloginWorld()
  w.mock.setScenario('auth-expired')

  expect(await (await w.ctx.get(commands)).run()).toBe(0)

  expect(w.mock.lastDeviceCodeBody).not.toBeNull()
  expect(await (await w.ctx.get(token)).get()).toBe('dfoa_test')
})

it('saves only once another login in the same config dir has finished saving', async () => {
  const w = await loginWorld()
  let release = () => {}
  const otherLoginHolds = new Promise<void>((resolve) => {
    release = resolve
  })
  let acquired = () => {}
  const lockTaken = new Promise<void>((resolve) => {
    acquired = resolve
  })
  const otherLogin = withLoginFlowLock(w.ctx, async () => {
    acquired()
    await otherLoginHolds
  })
  await lockTaken

  const run = (await w.ctx.get(commands)).run()
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(await (await w.ctx.get(session)).current()).toBeNull()

  release()
  await otherLogin
  expect(await run).toBe(0)
  expect(await (await w.ctx.get(token)).get()).toBe('dfoa_test')
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
    message: 'unset DIFY_TOKEN or DIFY_TOKEN_FILE to log in interactively',
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
    message: 'unset DIFY_TOKEN or DIFY_TOKEN_FILE to log in interactively',
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

async function loginWorld() {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const w = await testContext({
    login: false,
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--no-keyring', '--insecure'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  return w
}

it.each(['legacy-token-route', 'legacy-token-route-html-404'] as const)(
  'finishes a login against %s',
  async (scenario) => {
    const w = await loginWorld()
    w.mock.setScenario(scenario)
    expect(await (await w.ctx.get(commands)).run()).toBe(0)
    expect(await (await w.ctx.get(token)).get()).toBe('dfoa_test')
  },
)

it('refuses a bad verification_uri_complete before printing or opening anything', async () => {
  const w = await loginWorld()
  w.mock.setScenario('bad-verification-uri-complete')
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'unknown',
    message: expect.stringContaining('unsupported scheme "ftp"'),
  })
  expect(w.io.errBuf()).not.toMatch(/open /)
})

it('two config dirs on one host log in with different device labels', async () => {
  const labels: unknown[] = []
  for (const _dir of ['first', 'second']) {
    const w = await loginWorld()
    expect(await (await w.ctx.get(commands)).run()).toBe(0)
    const id = await installationId(w.ctx)
    expect(w.mock.lastDeviceCodeBody).toEqual({
      client_id: 'difyctl',
      device_label: `${hostname().slice(0, DEVICE_LABEL_HOSTNAME_MAX)} (${id.slice(0, DEVICE_LABEL_ID_LENGTH)})`,
    })
    labels.push(w.mock.lastDeviceCodeBody?.device_label)
  }
  expect(new Set(labels).size).toBe(2)
})
