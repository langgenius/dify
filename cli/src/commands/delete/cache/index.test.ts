import type { TestWorld } from '@test/fixtures/kernel'
import { existsSync, readFileSync } from 'node:fs'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { catalog } from '@/plugins/catalog'
import { commands } from '@/plugins/commands'

const FIXTURE = readFileSync(new URL('../../../../test/fixtures/catalog.json', import.meta.url))

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('deletes the cached catalog file', async () => {
  const w = await testContext({ login: false, env: true, argv: ['delete', 'cache'] })
  worlds.push(w)
  const cache = await w.ctx.get(catalog)
  await cache.replace(FIXTURE)

  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w.io.outBuf())).toEqual({ cleared: true })
  expect(existsSync(cache.path)).toBe(false)
  expect(cache.loaded).toBe(false)
})

it('rejects with exit 4 when not logged in', async () => {
  const w = await testContext({ login: false, argv: ['delete', 'cache'] })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'not_logged_in',
  })
})
