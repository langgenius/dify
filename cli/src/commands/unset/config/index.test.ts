import type { TestWorld } from '@test/fixtures/kernel'
import { writeFile } from 'node:fs/promises'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'
import { config } from '@/plugins/config'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('removes a value, restoring its default', async () => {
  const w = await testContext({ login: false, argv: ['unset', 'config', 'http.timeout'] })
  worlds.push(w)
  const service = await w.ctx.get(config)
  await writeFile(service.path, 'http:\n  timeout: 5000\n')

  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(await service.get('http.timeout')).toBe(30_000)
})

it('rejects an unknown key with exit 2', async () => {
  const w = await testContext({ login: false, argv: ['unset', 'config', 'nope'] })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'config_invalid_key',
  })
})
