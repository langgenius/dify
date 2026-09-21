import type { TestWorld } from '@test/fixtures/kernel'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'
import { session } from '@/plugins/session'
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
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--insecure'],
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
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--insecure'],
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
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--insecure'],
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
    argv: ['login', '--server', seed.mock.url, '--no-browser', '--insecure'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  w.mock.setScenario('sso')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const login = await (await w.ctx.get(session)).current()
  expect(login?.email).toBe('sso@dify.ai')
  expect(login?.account).toBeNull()
})
