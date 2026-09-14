import type { DifyMock } from '@test/fixtures/dify-mock/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMock } from '@test/fixtures/dify-mock/server'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { AppsClient } from '@/api/apps'
import { Registry } from '@/auth/hosts'
import { buildAuthedContext } from './authed-command'

let server: DifyMock | undefined
let dir: string | undefined

afterEach(async () => {
  vi.unstubAllEnvs()
  await server?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function setup(token: string) {
  server = await startMock({ scenario: token.startsWith('sk-') ? 'resource-token' : 'happy' })
  dir = await mkdtemp(join(tmpdir(), 'difyctl-env-token-'))
  vi.stubEnv('DIFY_CONFIG_DIR', dir)
  vi.stubEnv('DIFY_HOST', server.url)
  vi.stubEnv('DIFY_TOKEN', token)
}

const command = {
  error: (message: string): never => {
    throw new Error(message)
  },
}

describe('DIFY_TOKEN authentication', () => {
  it('bootstraps the token workspace and lists only bound apps without a login', async () => {
    await setup('sk-test-resource')
    const ctx = await buildAuthedContext(command, { retryFlag: 0 })
    expect(ctx.active.ctx.workspace?.role).toBe('')
    const apps = await new AppsClient(ctx.http).list({ workspaceId: ctx.active.ctx.workspace!.id })
    expect(apps.data).toHaveLength(1)
    expect(apps.data[0]?.workspace_id).toBe(ctx.active.ctx.workspace!.id)
    expect((await Registry.load()).resolveActive()).toBeUndefined()
  })

  it('uses an OAuth environment token without a login', async () => {
    await setup('dfoa_test')
    const ctx = await buildAuthedContext(command, { retryFlag: 0 })
    expect(ctx.active.ctx.account.email).not.toBe('')
    expect((await Registry.load()).resolveActive()).toBeUndefined()
  })

  it('reports invalid tokens without falling back to login', async () => {
    await setup('sk-invalid')
    await expect(buildAuthedContext(command, { retryFlag: 0 })).rejects.toMatchObject({
      httpStatus: 401,
    })
  })
})

it('ignores broken saved login state when DIFY_TOKEN is provided', async () => {
  await setup('dfoa_test')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(dir!, 'hosts.yml'), 'invalid: [')
  const ctx = await buildAuthedContext(command, { retryFlag: 0 })
  expect(ctx.active.ctx.account.email).not.toBe('')
})
