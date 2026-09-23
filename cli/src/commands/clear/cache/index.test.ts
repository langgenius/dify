import type { TestWorld } from '@test/fixtures/kernel'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { catalog } from '@/plugins/catalog'
import { commands } from '@/plugins/commands'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('deletes the cached catalog file', async () => {
  const w = await testContext({ login: true, argv: ['refresh', 'cache'] })
  worlds.push(w)
  await (await w.ctx.get(commands)).run()
  expect((await w.ctx.get(catalog)).loaded).toBe(true)

  const w2 = await testContext({ login: true, argv: ['clear', 'cache'], reuseDirOf: w })
  worlds.push(w2)
  expect(await (await w2.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(w2.io.outBuf())).toEqual({ cleared: true })
  expect((await w2.ctx.get(catalog)).loaded).toBe(false)
})

it('rejects with exit 4 when not logged in', async () => {
  const w = await testContext({ login: false, argv: ['clear', 'cache'] })
  worlds.push(w)
  await expect((await w.ctx.get(commands)).run()).rejects.toMatchObject({
    code: 'not_logged_in',
  })
})
