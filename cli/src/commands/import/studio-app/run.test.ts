import type { Import } from '@dify/contracts/api/openapi/types.gen'
import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { ActiveContext } from '@/auth/hosts'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { DSL_YAML } from '@test/fixtures/dify-mock/scenarios'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDslClient } from '@/api/app-dsl'
import { bufferStreams } from '@/sys/io/streams'
import { ZERO } from '@/util/uuid.js'
import { pluginDependencyLabel, runImportApp } from './run.js'

const WS_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

const baseActive: ActiveContext = {
  host: '127.0.0.1',
  email: 'tester@dify.ai',
  ctx: {
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
    workspace: { id: WS_ID, name: 'Default', role: 'owner' },
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
    const filePath = join(os.tmpdir(), `difyctl-import-test-${Date.now()}.yaml`)
    writeFileSync(filePath, DSL_YAML, 'utf8')
    return filePath
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

  it('returns empty leakedDependencies when the app has no missing plugins', async () => {
    const dslFile = tmpDslFile()
    const { leakedDependencies } = await runImportApp({ fromFile: dslFile }, { active: baseActive, http: http() })

    expect(leakedDependencies).toEqual([])
  })

  it('surfaces leaked dependencies reported by check-dependencies', async () => {
    const dslFile = tmpDslFile()
    const completed: Import = { id: 'imp-1', status: 'completed', app_id: 'app-1', app_mode: 'chat' }
    const stub = Object.assign(Object.create(AppDslClient.prototype), {
      importApp: async () => completed,
      confirmImport: async () => completed,
      checkDependencies: async () => ({
        leaked_dependencies: [
          { type: 'marketplace', value: { marketplace_plugin_unique_identifier: 'langgenius/openai:0.0.1' } },
        ],
      }),
    }) as AppDslClient

    const { leakedDependencies } = await runImportApp(
      { fromFile: dslFile },
      { active: baseActive, http: http(), dslFactory: () => stub },
    )

    expect(leakedDependencies).toHaveLength(1)
    const [dep] = leakedDependencies
    if (dep === undefined)
      throw new Error('expected one leaked dependency')
    expect(pluginDependencyLabel(dep)).toBe('langgenius/openai:0.0.1')
  })
})

describe('pluginDependencyLabel', () => {
  it('reads the github plugin identifier', () => {
    const label = pluginDependencyLabel({
      type: 'github',
      value: { github_plugin_unique_identifier: 'owner/repo:1.0.0' },
    })
    expect(label).toBe('owner/repo:1.0.0')
  })

  it('reads the package plugin identifier', () => {
    const label = pluginDependencyLabel({ type: 'package', value: { plugin_unique_identifier: 'pkg:2.0.0' } })
    expect(label).toBe('pkg:2.0.0')
  })

  it('falls back to current_identifier then a placeholder', () => {
    expect(pluginDependencyLabel({ type: 'package', value: {}, current_identifier: 'fallback' })).toBe('fallback')
    expect(pluginDependencyLabel({ type: 'package', value: null })).toBe('<unknown>')
  })
})
