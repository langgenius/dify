import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { ActiveContext } from '@/auth/hosts'
import { writeFileSync } from 'node:fs'
import { DSL_YAML } from '@test/fixtures/dify-mock/scenarios'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bufferStreams } from '@/sys/io/streams'
import { ZERO } from '@/util/uuid.js'
import { runImportApp } from './run.js'

const baseActive: ActiveContext = {
  host: '127.0.0.1',
  email: 'tester@dify.ai',
  ctx: {
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [{ id: 'ws-1', name: 'Default', role: 'owner' }],
  },
  scheme: 'http',
}

describe('runImportApp', () => {
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

  function tmpDslFile(): string {
    const path = `/tmp/difyctl-import-test-${Date.now()}.yaml`
    writeFileSync(path, DSL_YAML, 'utf8')
    return path
  }

  it('completes import from a local file path', async () => {
    const dslFile = tmpDslFile()
    const { result } = await runImportApp({ fromFile: dslFile }, { active: baseActive, http: http() })

    expect(result.status).toBe('completed')
    expect(result.app_id).toBe('app-1')
  })

  it('sends yaml_content in the request body', async () => {
    const dslFile = tmpDslFile()
    await runImportApp({ fromFile: dslFile }, { active: baseActive, http: http() })

    expect(mock.lastImportBody?.mode).toBe('yaml-content')
    expect(mock.lastImportBody?.yaml_content).toBe(DSL_YAML)
  })

  it('sends yaml_url when given --from-url', async () => {
    await runImportApp(
      { fromUrl: 'https://example.com/app.yaml' },
      { active: baseActive, http: http() },
    )

    expect(mock.lastImportBody?.mode).toBe('yaml-url')
    expect(mock.lastImportBody?.yaml_url).toBe('https://example.com/app.yaml')
  })

  it('forwards optional name and description overrides', async () => {
    const dslFile = tmpDslFile()
    await runImportApp(
      { fromFile: dslFile, name: 'My App', description: 'desc' },
      { active: baseActive, http: http() },
    )

    expect(mock.lastImportBody?.name).toBe('My App')
    expect(mock.lastImportBody?.description).toBe('desc')
  })

  it('auto-confirms a pending (202) import and emits a note on err stream', async () => {
    mock.setScenario('import-pending')
    const io = bufferStreams()
    const dslFile = tmpDslFile()

    const { result } = await runImportApp(
      { fromFile: dslFile },
      { active: baseActive, http: http(), io },
    )

    expect(result.status).toBe('completed')
    expect(io.errBuf()).toContain('confirming automatically')
  })

  it('throws on import-failed (400) response', async () => {
    mock.setScenario('import-failed')
    const dslFile = tmpDslFile()

    await expect(
      runImportApp({ fromFile: dslFile }, { active: baseActive, http: http() }),
    ).rejects.toThrow('Import failed')
  })

  it('uses workspace from --workspace flag over context default', async () => {
    const dslFile = tmpDslFile()
    await runImportApp(
      { fromFile: dslFile, workspace: ZERO },
      { active: baseActive, http: http() },
    )

    expect(mock.lastImportBody).not.toBeNull()
  })

  it('throws UsageInvalidFlag when fromFile path does not exist', async () => {
    await expect(
      runImportApp({ fromFile: '/tmp/difyctl-no-such-file-ever.yaml' }, { active: baseActive, http: http() }),
    ).rejects.toThrow('file not found')
  })

  it('throws UsageInvalidFlag when both fromFile and fromUrl are given', async () => {
    const dslFile = tmpDslFile()
    await expect(
      runImportApp({ fromFile: dslFile, fromUrl: 'https://example.com/app.yaml' }, { active: baseActive, http: http() }),
    ).rejects.toThrow('mutually exclusive')
  })

  it('throws UsageInvalidFlag when neither fromFile nor fromUrl is given', async () => {
    await expect(
      runImportApp({}, { active: baseActive, http: http() }),
    ).rejects.toThrow('required')
  })
})
