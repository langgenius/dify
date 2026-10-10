import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { config } from './index'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'difyctl-cfg-'))
  process.env.DIFY_CONFIG_DIR = dir
})
afterEach(() => {
  delete process.env.DIFY_CONFIG_DIR
})

it('returns defaults and the file path when nothing is on disk', async () => {
  const c = await new Context().get(config)
  expect(await c.get()).toEqual({
    schema_version: 1,
    http: { timeout: 30_000 },
    path: join(dir, 'config.yml'),
  })
})

it('set / get / unset round-trip through yaml', async () => {
  const c = await new Context().get(config)
  await c.set('http.timeout', '5000')
  expect(await c.get('http.timeout')).toBe(5000)
  await c.unset('http.timeout')
  expect(await c.get('http.timeout')).toBe(30_000)
})

it('rejects unknown keys and wrong types with exit 2', async () => {
  const c = await new Context().get(config)
  await expect(c.set('nope', '1')).rejects.toMatchObject({ code: 'config_invalid_key' })
  await expect(c.set('http.timeout', 'fast')).rejects.toMatchObject({
    code: 'config_invalid_value',
  })
})

it('rejects a newer schema_version with exit 6', async () => {
  writeFileSync(join(dir, 'config.yml'), 'schema_version: 2\n')
  const c = await new Context().get(config)
  await expect(c.get()).rejects.toMatchObject({ code: 'config_schema_unsupported' })
})
