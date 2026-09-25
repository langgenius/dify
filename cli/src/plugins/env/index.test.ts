import { afterEach, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { env } from './index'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

it('reads and validates DIFY_* variables into a frozen object', async () => {
  process.env.DIFY_SERVER = 'https://dify.example'
  process.env.DIFY_TOKEN = 'dfoa_x'
  process.env.DIFY_CONFIG_DIR = '/tmp/cfg'
  const e = await new Context().get(env)
  expect(e.server).toBe('https://dify.example')
  expect(e.configDir).toBe('/tmp/cfg')
  expect(Object.isFrozen(e)).toBe(true)
})

it('rejects a token without a server with exit 2', async () => {
  delete process.env.DIFY_SERVER
  process.env.DIFY_TOKEN = 'dfoa_x'
  await expect(new Context().get(env)).rejects.toMatchObject({ code: 'usage_invalid_flag' })
})

it('rejects a non-http server url', async () => {
  process.env.DIFY_SERVER = 'ftp://x'
  await expect(new Context().get(env)).rejects.toMatchObject({ code: 'usage_invalid_flag' })
})
