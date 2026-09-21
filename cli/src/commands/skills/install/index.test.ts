import type { TestWorld } from '@test/fixtures/kernel'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('--stdout prints the skill text and writes nothing', async () => {
  const w = await testContext({ login: false, argv: ['skills', 'install', '--stdout'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  expect(w.io.outBuf()).toContain('name: difyctl')
})

it('writes the skill into an explicit directory with --yes', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const dir = join(seed.dir, 'target')
  const w = await testContext({
    login: false,
    argv: ['skills', 'install', dir, '--yes'],
    reuseDirOf: seed,
  })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const body = JSON.parse(w.io.outBuf()) as { wrote: string[] }
  expect(body.wrote).toHaveLength(1)
  const content = await readFile(body.wrote[0]!, 'utf8')
  expect(content).toContain('name: difyctl')
})
