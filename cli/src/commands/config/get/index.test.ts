import type { TestWorld } from '@test/fixtures/kernel'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'
import { config } from '@/plugins/config'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('reads a value written directly through the config service', async () => {
  const w = await testContext({ login: false, argv: ['config', 'get', 'http.timeout'] })
  worlds.push(w)
  await (await w.ctx.get(config)).set('http.timeout', '5000')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toBe(5000)
})

it('prints the whole doc with its path when no key is given', async () => {
  const w = await testContext({ login: false, argv: ['config', 'get'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const body = JSON.parse(w.io.outBuf()) as { path: string; http: { timeout: number } }
  expect(body.http.timeout).toBe(30_000)
  expect(body.path).toContain('config.yml')
})

it('rejects an unknown key with exit 2', async () => {
  const w = await testContext({ login: false, argv: ['config', 'get', 'nope'] })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'config_invalid_key',
  })
})
