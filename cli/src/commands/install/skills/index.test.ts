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

it('writes the difyctl skill into the given skills root', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const dir = join(seed.dir, 'target')
  const argv = ['install', 'skills', dir]
  const w = await testContext({ login: false, argv, reuseDirOf: seed })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const body = JSON.parse(w.io.outBuf()) as { wrote: string[] }
  expect(body.wrote).toContain(join(dir, 'difyctl', 'SKILL.md'))
  expect(await readFile(join(dir, 'difyctl', 'SKILL.md'), 'utf8')).toContain('name: difyctl')
})
