import type { TestWorld } from '@test/fixtures/kernel'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('lists catalog ops sorted by id, internal hidden unless --all', async () => {
  const a = await testContext({ login: true, argv: ['ops'] })
  worlds.push(a)
  expect(await (await a.ctx.get(commands)).run()).toBe(0)
  const rows = JSON.parse(a.io.outBuf()).ops as { id: string; kind: string; tags: string[] }[]
  const ids = rows.map((r) => r.id)
  expect(ids).toEqual([...ids].sort())
  expect(ids).toContain('console_app.workflow.run')
  expect(ids).not.toContain('workspace.switch')
  expect(rows.find((r) => r.id === 'console_app.list')).toMatchObject({
    kind: 'list',
    tags: ['console_app'],
  })
  const b = await testContext({ login: true, argv: ['ops', '--all'] })
  worlds.push(b)
  await (await b.ctx.get(commands)).run()
  expect(JSON.parse(b.io.outBuf()).ops.map((r: { id: string }) => r.id)).toContain(
    'workspace.switch',
  )
})

it('root help reuses a cached catalog instead of fetching again', async () => {
  const w = await testContext({ login: true, argv: ['ops'] })
  worlds.push(w)
  await (await w.ctx.get(commands)).run()
  expect(w.mock.requestCount).toBe(1)
  // Same config/cache dirs and the same mock, fresh streams.
  const w2 = await testContext({ login: true, argv: ['--help'], reuseDirOf: w })
  worlds.push(w2)
  await (await w2.ctx.get(commands)).run()
  expect(JSON.parse(w2.io.outBuf()).ops.length).toBeGreaterThan(20)
  expect(w2.mock.requestCount).toBe(1)
})
