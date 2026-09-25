import type { TestWorld } from '@test/fixtures/kernel'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'

const REPO_SKILLS = fileURLToPath(new URL('../../../../../skills', import.meta.url))

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('writes the repo skills into the given skills root', async () => {
  const seed = await testContext({ login: false })
  worlds.push(seed)
  const dir = join(seed.dir, 'target')
  const argv = ['install', 'skills', dir, '--from', REPO_SKILLS]
  const w = await testContext({ login: false, argv, reuseDirOf: seed })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const body = JSON.parse(w.io.outBuf()) as { wrote: string[] }
  expect(body.wrote).toContain(join(dir, 'difyctl', 'SKILL.md'))
  expect(await readFile(join(dir, 'difyctl', 'SKILL.md'), 'utf8')).toContain('name: difyctl')
})
