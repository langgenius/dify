import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { ActiveContext } from '@/auth/hosts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadAppInfoCache } from '@/cache/app-info'
import { resumeApp } from '@/commands/resume/app/run'
import { ENV_CACHE_DIR } from '@/store/dir'
import { CACHE_APP_INFO, getCache } from '@/store/manager'
import { bufferStreams } from '@/sys/io/streams'
import { runApp } from './run.js'

function active(): ActiveContext {
  return {
    host: 'http://localhost',
    email: 't@d.ai',
    ctx: {
      account: { id: 'acct-1', email: 't@d.ai', name: 'T' },
      workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    },
  }
}

describe('runApp', () => {
  let mock: DifyMock
  let dir: string
  let prevCacheDir: string | undefined
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
    dir = await mkdtemp(join(tmpdir(), 'difyctl-runapp-'))
    prevCacheDir = process.env[ENV_CACHE_DIR]
    process.env[ENV_CACHE_DIR] = dir
  })
  afterEach(async () => {
    if (prevCacheDir === undefined)
      delete process.env[ENV_CACHE_DIR]
    else
      process.env[ENV_CACHE_DIR] = prevCacheDir
    await mock.stop()
    await rm(dir, { recursive: true, force: true })
  })

  it('chat: prints answer + conversation hint to stderr', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-1', message: 'hi' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: hi\n')
    expect(io.errBuf()).toContain('--conversation conv-1')
  })

  it('workflow: rejects positional message with usage error', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await expect(runApp(
      { appId: 'app-2', message: 'hi' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )).rejects.toMatchObject({ code: 'usage_invalid_flag' })
  })

  it('workflow: prints single-string output as plain text', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-2', inputs: { x: '1' } },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: \n')
  })

  it('json: passes through full envelope', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-1', message: 'hi', format: 'json' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    const parsed = JSON.parse(io.outBuf()) as { mode: string, answer: string }
    expect(parsed.mode).toBe('chat')
    expect(parsed.answer).toBe('echo: hi')
  })

  it('rejects unknown format', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', format: 'bogus' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io },
    )).rejects.toThrow(/not supported/)
  })

  it('unknown app id surfaces as error', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'nope', message: 'hi' },
      {
        active: active(),
        http: testHttpClient(mock.url, { bearer: 'dfoa_test', retryAttempts: 0 }),
        host: mock.url,
        io,
      },
    )).rejects.toThrow()
  })

  it('--stream chat: streams answer to stdout and hint to stderr', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toContain('echo: ')
    expect(io.outBuf()).toContain('hi')
    expect(io.errBuf()).toContain('--conversation conv-1')
  })

  it('--stream -o json chat: aggregates into blocking-shape envelope', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true, format: 'json' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    const parsed = JSON.parse(io.outBuf()) as { mode: string, answer: string, conversation_id: string }
    expect(parsed.mode).toBe('chat')
    expect(parsed.answer).toBe('echo: hi')
    expect(parsed.conversation_id).toBe('conv-1')
  })

  it('agent-chat without --stream: collects and prints answer', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-4', workspace: 'ws-2', message: 'do research' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toContain('do research')
    expect(io.errBuf()).toContain('--conversation conv-1')
  })

  it('agent-chat with --stream: live-prints answer and thoughts to stderr', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-4', workspace: 'ws-2', message: 'go', stream: true },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toContain('go')
    expect(io.errBuf()).toContain('thought:')
  })

  it('--stream workflow -o json: aggregates from workflow_finished', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-2', inputs: { x: '1' }, stream: true, format: 'json' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    const parsed = JSON.parse(io.outBuf()) as { mode: string, data: { status: string } }
    expect(parsed.mode).toBe('workflow')
    expect(parsed.data.status).toBe('succeeded')
  })

  it('stream-error scenario: error event surfaces typed BaseError', async () => {
    mock.setScenario('stream-error')
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await expect(runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { active: active(), http: testHttpClient(mock.url, { bearer: 'dfoa_test', retryAttempts: 0 }), host: mock.url, io, cache },
    )).rejects.toMatchObject({ code: 'server_5xx' })
  })

  it('--inputs-file: reads inputs from file', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    const inputsFile = join(dir, 'inputs.json')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(inputsFile, JSON.stringify({ x: 'from-file' }))
    await runApp(
      { appId: 'app-2', inputsFile },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: \n')
  })

  it('--inputs-file: rejects non-object JSON', async () => {
    const io = bufferStreams()
    const { writeFile } = await import('node:fs/promises')
    const inputsFile = join(dir, 'bad.json')
    await writeFile(inputsFile, JSON.stringify([1, 2, 3]))
    await expect(runApp(
      { appId: 'app-2', inputsFile },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io },
    )).rejects.toThrow(/must be a JSON object/)
  })

  it('--inputs: accepts JSON object string', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-2', inputsJson: '{"x":"hello"}' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: \n')
  })

  it('--inputs and --inputs-file are mutually exclusive', async () => {
    const io = bufferStreams()
    const { writeFile } = await import('node:fs/promises')
    const inputsFile = join(dir, 'f.json')
    await writeFile(inputsFile, '{}')
    await expect(runApp(
      { appId: 'app-2', inputsJson: '{}', inputsFile },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io },
    )).rejects.toThrow(/mutually exclusive/)
  })

  it('hitl pause (text): writes readable block to stdout, hint to stderr, exits 0', async () => {
    mock.setScenario('hitl-pause')
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    let exitCode = -1
    await expect(runApp(
      { appId: 'app-2', inputs: {} },
      {
        active: active(),
        http: testHttpClient(mock.url, 'dfoa_test'),
        host: mock.url,
        io,
        cache,
        exit: (code) => {
          exitCode = code
          throw new Error(`exit:${code}`)
        },
      },
    )).rejects.toThrow('exit:0')
    expect(exitCode).toBe(0)
    const out = io.outBuf()
    expect(out).toContain('Workflow paused')
    expect(out).toContain('First Node')
    expect(out).toContain('Please provide input')
    expect(out).toContain('[submit]')
    expect(io.errBuf()).toContain('difyctl resume app')
    expect(io.errBuf()).toContain('ft-hitl-1')
  })

  it('hitl pause (json): writes JSON envelope to stdout, exits 0', async () => {
    mock.setScenario('hitl-pause')
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    let exitCode = -1
    await expect(runApp(
      { appId: 'app-2', inputs: {}, format: 'json' },
      {
        active: active(),
        http: testHttpClient(mock.url, 'dfoa_test'),
        host: mock.url,
        io,
        cache,
        exit: (code) => {
          exitCode = code
          throw new Error(`exit:${code}`)
        },
      },
    )).rejects.toThrow('exit:0')
    expect(exitCode).toBe(0)
    const payload = JSON.parse(io.outBuf()) as { status: string, form_token: string, workflow_run_id: string }
    expect(payload.status).toBe('paused')
    expect(payload.form_token).toBe('ft-hitl-1')
    expect(payload.workflow_run_id).toBe('wf-run-hitl-1')
  })

  it('resume: withHistory: false completes successfully', async () => {
    mock.setScenario('hitl-resume')
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await resumeApp(
      { appId: 'app-2', formToken: 'ft-hitl-1', workflowRunId: 'wf-run-hitl-1', action: 'submit', inputs: {}, withHistory: false },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: resumed\n')
  })

  it('resume: submits form and streams workflow to completion', async () => {
    mock.setScenario('hitl-resume')
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await resumeApp(
      { appId: 'app-2', formToken: 'ft-hitl-1', workflowRunId: 'wf-run-hitl-1', action: 'submit', inputs: {} },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: resumed\n')
  })

  it('resume --stream: live-prints workflow node progress to stderr', async () => {
    mock.setScenario('hitl-resume')
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await resumeApp(
      { appId: 'app-2', formToken: 'ft-hitl-1', workflowRunId: 'wf-run-hitl-1', action: 'submit', inputs: {}, stream: true },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    // stream mode for workflow: node_started → "→ <title>" on stderr
    expect(io.errBuf()).toContain('After Resume')
  })

  it('workflow: --file remote URL is passed as remote_url input variable', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-2', files: ['doc=https://example.com/report.pdf'] },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: \n')
    expect(mock.uploadCallCount).toBe(0)
    const runInputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(runInputs).toBeDefined()
    expect(runInputs.doc).toMatchObject({
      type: 'document',
      transfer_method: 'remote_url',
      url: 'https://example.com/report.pdf',
    })
  })

  it('workflow: --file @path uploads file and passes local_file input variable', async () => {
    const { writeFile } = await import('node:fs/promises')
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    const filePath = join(dir, 'test.pdf')
    await writeFile(filePath, 'fake pdf content')
    await runApp(
      { appId: 'app-2', files: [`doc=@${filePath}`] },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: \n')
    expect(mock.uploadCallCount).toBe(1)
    const runInputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(runInputs).toBeDefined()
    expect(runInputs.doc).toMatchObject({
      transfer_method: 'local_file',
      upload_file_id: 'upload-file-1',
    })
  })

  it('422 on run: invalidates cache and adds republish hint', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    // warm cache with successful run
    await runApp(
      { appId: 'app-1', message: 'hi' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(cache.get(mock.url, 'app-1')).toBeDefined()

    mock.setScenario('run-422-stale')
    const err = await runApp(
      { appId: 'app-1', message: 'hi' },
      { active: active(), http: testHttpClient(mock.url, { bearer: 'dfoa_test', retryAttempts: 0 }), host: mock.url, io, cache },
    ).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'server_4xx_other', httpStatus: 422 })
    expect((err as { hint?: string }).hint).toMatch(/cache cleared/)
    expect(cache.get(mock.url, 'app-1')).toBeUndefined()
  })

  it('workflow: --file overrides same-named key from --inputs (file wins)', async () => {
    const io = bufferStreams()
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runApp(
      { appId: 'app-2', inputs: { doc: 'old-value' }, files: ['doc=https://example.com/override.pdf'] },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, io, cache },
    )
    expect(io.outBuf()).toBe('echo: \n')
    const runInputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(runInputs).toBeDefined()
    const docInput = runInputs.doc as Record<string, unknown>
    expect(docInput.transfer_method).toBe('remote_url')
    expect(docInput.url).toBe('https://example.com/override.pdf')
  })
})
