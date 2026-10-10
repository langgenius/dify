import type { TestWorld } from '@test/fixtures/kernel'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('prints the client version without a login and adds the server with one', async () => {
  const a = await testContext({ login: false, argv: ['version'] })
  worlds.push(a)
  expect(await (await a.ctx.get(commands)).run()).toBe(0)
  expect(JSON.parse(a.io.outBuf())).toEqual({
    client: {
      version: '0.0.0-test',
      commit: '0000000',
      channel: 'dev',
      build_date: '1970-01-01T00:00:00.000Z',
    },
  })
  const b = await testContext({ login: true, argv: ['version'] })
  worlds.push(b)
  await (await b.ctx.get(commands)).run()
  expect(JSON.parse(b.io.outBuf()).server).toEqual({ version: '1.6.4', edition: 'CLOUD' })
})
