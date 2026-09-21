import type { TestWorld } from '@test/fixtures/kernel'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'
import { config } from '@/plugins/config'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('removes a value, restoring its default', async () => {
  const w = await testContext({ login: false, argv: ['config', 'unset', 'http.timeout'] })
  worlds.push(w)
  await (await w.ctx.get(config)).set('http.timeout', '5000')
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(await (await w.ctx.get(config)).get('http.timeout')).toBe(30_000)
})

it('rejects an unknown key with exit 2', async () => {
  const w = await testContext({ login: false, argv: ['config', 'unset', 'nope'] })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'config_invalid_key',
  })
})
