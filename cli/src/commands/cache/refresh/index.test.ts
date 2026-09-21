import type { TestWorld } from '@test/fixtures/kernel'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { testContext } from '@test/fixtures/kernel'
import { afterEach, expect, it } from 'vite-plus/test'
import { commands } from '@/plugins/commands'

const FIXTURE = readFileSync(join(__dirname, '../../../../test/fixtures/catalog.json'))
const FINGERPRINT = createHash('sha256').update(FIXTURE).digest('hex')

const worlds: TestWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
})

it('writes the catalog file and reports the op count and fingerprint', async () => {
  const w = await testContext({ login: true, argv: ['cache', 'refresh'] })
  worlds.push(w)
  expect(await (await w.ctx.get(commands)).run()).toBe(0)
  const body = JSON.parse(w.io.outBuf()) as { ops: number; fingerprint: string; path: string }
  expect(body.fingerprint).toBe(FINGERPRINT)
  expect(body.ops).toBeGreaterThan(20)
  expect(readFileSync(body.path)).toEqual(FIXTURE)
})
