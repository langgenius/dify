import type { TestWorld } from '@test/fixtures/kernel'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { commands } from '@/plugins/commands'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

function catalogFiles(dir: string): string[] {
  const catalogDir = join(dir, 'catalog')
  return existsSync(catalogDir) ? readdirSync(catalogDir) : []
}

it('revokes the session on the server and clears local state', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toEqual({ logged_out: true, server: w.mock.url })
  expect(w.io.errBuf()).toBe('')

  expect(await (await w.ctx.get(session)).current()).toBeNull()
  expect(catalogFiles(w.dir)).toEqual([])
  await expect((await new Context().get(token)).get()).rejects.toMatchObject({
    code: 'not_logged_in',
  })
})

it('still clears local state and reports a failed server revoke', async () => {
  const w = await testContext({ login: true, argv: ['logout'] })
  worlds.push(w)
  w.mock.setScenario('server-5xx')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.io.errBuf()).toMatch(/^server revoke failed:/)

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
