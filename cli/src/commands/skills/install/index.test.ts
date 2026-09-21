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

it('writes the collection into the given skills root', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const dir = join(seed.dir, 'target')
  const w = await testContext({ login: false, argv: ['skills', 'install', dir], reuseDirOf: seed })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const body = JSON.parse(w.io.outBuf()) as { wrote: string[] }
  expect(body.wrote).toEqual([join(dir, 'difyctl', 'SKILL.md')])
  expect(await readFile(body.wrote[0] as string, 'utf8')).toContain('name: difyctl')
})
