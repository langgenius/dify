import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { ActiveContext } from '@/auth/hosts'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringifyOutput, table } from '@/framework/output'
import { AppListOutput } from './handlers.js'
import { runGetApp } from './run.js'

const baseActive: ActiveContext = {
  host: '127.0.0.1',
  email: 'tester@dify.ai',
  ctx: {
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
    workspace: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Default', role: 'owner' },
  },
  scheme: 'http',
}

describe('runGetApp', () => {
  let mock: DifyMock

  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
  })

  afterEach(async () => {
    await mock.stop()
  })

  function http() {
    return testHttpClient(mock.url, 'dfoa_test')
  }

  async function render(opts: Parameters<typeof runGetApp>[0] = {}): Promise<string> {
    const result = await runGetApp(opts, { active: baseActive, http: http() })
    return stringifyOutput(table({
      format: opts.format ?? '',
      data: result.data,
    }))
  }

  it('list (no id, default format) renders table with NAME ID MODE TAGS UPDATED', async () => {
    const out = await render()
    expect(out).toMatch(/^NAME\s+ID\s+MODE\s+TAGS\s+UPDATED/)
    expect(out).toContain('Greeter')
    expect(out).toContain('app-1')
    expect(out).toContain('chat')
    expect(out).toContain('demo')
    expect(out).toContain('Workflow')
    expect(out).not.toContain('app-3')
  })

  it('defines table headers on the output class', () => {
    expect(AppListOutput.tableColumns().map(column => column.name)).toEqual([
      'NAME',
      'ID',
      'MODE',
      'TAGS',
      'UPDATED',
      'AUTHOR',
      'WORKSPACE',
    ])
  })

  it('by-id (single) renders 1-row table', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Greeter')
    expect(out).toContain('app-1')
    expect(out).not.toContain('Workflow')
  })

  it('--mode filters server-side', async () => {
    const out = await render({ mode: 'workflow' })
    expect(out).toContain('Workflow')
    expect(out).not.toContain('Greeter')
  })

  it('--tag filters server-side', async () => {
    const out = await render({ tag: 'demo' })
    expect(out).toContain('Greeter')
    expect(out).not.toContain('Workflow')
  })

  it('-A all-workspaces aggregates across workspaces sorted by id', async () => {
    const out = await render({ allWorkspaces: true })
    expect(out).toContain('app-1')
    expect(out).toContain('app-2')
    expect(out).toContain('app-3')
    const idxApp1 = out.indexOf('app-1')
    const idxApp3 = out.indexOf('app-3')
    expect(idxApp1).toBeLessThan(idxApp3)
  })

  it('-o json emits parseable JSON envelope', async () => {
    const out = await render({ format: 'json' })
    const parsed = JSON.parse(out) as { data: Array<{ id: string }>, total: number }
    expect(parsed.data).toHaveLength(2)
    expect(parsed.data.map(r => r.id).sort()).toEqual(['app-1', 'app-2'])
  })

  it('-o yaml emits YAML envelope', async () => {
    const out = await render({ format: 'yaml' })
    expect(out).toContain('data:')
    expect(out).toContain('id: app-1')
  })

  it('-o name emits ids one per line', async () => {
    const out = await render({ format: 'name' })
    expect(out.trim().split('\n').sort()).toEqual(['app-1', 'app-2'])
  })

  it('-o wide includes AUTHOR and WORKSPACE columns', async () => {
    const out = await render({ format: 'wide' })
    expect(out).toMatch(/^NAME\s+ID\s+MODE\s+TAGS\s+UPDATED\s+AUTHOR\s+WORKSPACE/)
    expect(out).toContain('tester')
    expect(out).toContain('Default')
  })

  it('rejects unknown format', async () => {
    await expect(render({ format: 'bogus' }))
      .rejects
      .toThrow(/not supported/)
  })

  it('--workspace flag overrides bundle default', async () => {
    const out = await render({ workspace: '550e8400-e29b-41d4-a716-446655440001' })
    expect(out).toContain('app-3')
    expect(out).toContain('OtherWS Bot')
    expect(out).not.toContain('Greeter')
  })

  it('throws NotLoggedIn-equivalent when no workspace can be resolved', async () => {
    const minimal: ActiveContext = {
      host: 'h',
      email: 'x@x.com',
      ctx: { account: { email: 'x@x.com', name: 'X' } },
    }
    await expect(runGetApp({}, { active: minimal, http: http() })).rejects.toThrow(/no workspace/)
  })
})
