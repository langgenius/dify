import type { TestWorld } from '@test/fixtures/kernel'
import type { BaseError } from '@/errors/base'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { ExitCode } from '@/errors/codes'
import { commands } from '@/plugins/commands'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('marks the pinned workspace, exactly one true', async () => {
  const w = await testContext({ login: true, argv: ['workspace', 'list'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const body = JSON.parse(w.io.outBuf()) as { data: Array<{ id: string; pinned: boolean }> }
  expect(body.data.length).toBeGreaterThan(0)
  const pinned = body.data.filter((row) => row.pinned)
  expect(pinned).toHaveLength(1)
  expect(pinned[0]?.id).toBe('ws-1')
})

it('a response with no data array is a server error, exit 1', async () => {
  const w = await testContext({ login: true, argv: ['workspace', 'list'] })
  worlds.push(w)
  w.mock.setScenario('workspaces-malformed')
  const err = await (await w.ctx.get(commands)).run().catch((e: unknown) => e)
  expect(err).toMatchObject({
    code: 'server_error',
    message: 'workspace list response has no data array',
  })
  expect((err as BaseError).exit()).toBe(ExitCode.Generic)
  expect(w.io.outBuf()).toBe('')
})
