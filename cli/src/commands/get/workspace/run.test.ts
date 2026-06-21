import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { ActiveContext } from '@/auth/hosts'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringifyOutput, table } from '@/framework/output'
import { WorkspaceListOutput } from './handlers.js'
import { EMPTY_WORKSPACES_MESSAGE, runGetWorkspace } from './run.js'

const baseActive: ActiveContext = {
  host: '127.0.0.1',
  email: 'tester@dify.ai',
  ctx: {
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
    workspace: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Default', role: 'owner' },
  },
  scheme: 'http',
}

describe('runGetWorkspace', () => {
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

  async function render(format = '', activeCtx = baseActive): Promise<string> {
    const result = await runGetWorkspace({ format }, { active: activeCtx, http: http() })
    if (result.kind === 'empty')
      return result.message
    return stringifyOutput(table({
      format,
      data: result.data,
    }))
  }

  it('default format renders ID NAME ROLE STATUS CURRENT table', async () => {
    const out = await render()
    expect(out).toMatch(/^ID\s+NAME\s+ROLE\s+STATUS\s+CURRENT/)
    expect(out).toContain('550e8400-e29b-41d4-a716-446655440000')
    expect(out).toContain('550e8400-e29b-41d4-a716-446655440001')
    expect(out).toContain('Default')
    expect(out).toContain('owner')
    expect(out).toContain('normal')
  })

  it('defines table headers on the output class', () => {
    expect(WorkspaceListOutput.tableColumns().map(column => column.name)).toEqual([
      'ID',
      'NAME',
      'ROLE',
      'STATUS',
      'CURRENT',
    ])
  })

  it('marks the current workspace with *', async () => {
    const out = await render()
    for (const line of out.split('\n')) {
      if (line.includes('550e8400-e29b-41d4-a716-446655440000'))
        expect(line).toContain('*')
      else if (line.includes('550e8400-e29b-41d4-a716-446655440001'))
        expect(line).not.toContain('*')
    }
  })

  it('falls back to active context workspace.id when server current=false', async () => {
    const overridden: ActiveContext = { ...baseActive, ctx: { ...baseActive.ctx, workspace: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Other', role: 'normal' } } }
    const out = await render('', overridden)
    for (const line of out.split('\n')) {
      if (line.includes('550e8400-e29b-41d4-a716-446655440001'))
        expect(line).toContain('*')
    }
  })

  it('-o json emits a parseable workspaces envelope', async () => {
    const out = await render('json')
    const parsed = JSON.parse(out) as { workspaces: Array<{ id: string, status: string, current: boolean }> }
    expect(parsed.workspaces).toHaveLength(2)
    expect(parsed.workspaces.map(w => w.id).sort()).toEqual(['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'])
    expect(parsed.workspaces[0]?.status).toBe('normal')
    expect(parsed.workspaces[0]?.current).toBe(true)
  })

  it('-o yaml emits "workspaces:" header', async () => {
    const out = await render('yaml')
    expect(out).toContain('workspaces:')
    expect(out).toContain('550e8400-e29b-41d4-a716-446655440000')
  })

  it('-o name emits ids joined by newline', async () => {
    const out = await render('name')
    expect(out.trim().split('\n').sort()).toEqual(['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'])
  })

  it('empty workspaces (sso scenario) prints external-SSO message regardless of format', async () => {
    mock.setScenario('sso')
    const out = await render()
    expect(out).toBe(EMPTY_WORKSPACES_MESSAGE)
    const jsonOut = await render('json')
    expect(jsonOut).toBe(EMPTY_WORKSPACES_MESSAGE)
  })

  it('rejects unknown -o format', async () => {
    await expect(render('csv'))
      .rejects
      .toThrow(/csv|not supported|format/i)
  })
})
