import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { dockerDir, middlewareComposeFile, runCommandOrThrow } from '../scripts/common.ts'
import { captureMiddlewareLogs } from '../scripts/setup.ts'

vi.mock('../scripts/common.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scripts/common.ts')>()),
  runCommandOrThrow: vi.fn(),
}))

describe('middleware diagnostics', () => {
  let logDir: string

  beforeEach(async () => {
    vi.resetAllMocks()
    logDir = await mkdtemp(path.join(os.tmpdir(), 'dify-middleware-logs-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(logDir, { force: true, recursive: true })
  })

  it('writes timestamped Compose stdout and stderr to the log artifact', async () => {
    vi.mocked(runCommandOrThrow).mockResolvedValue({
      exitCode: 0,
      stdout: 'plugin_daemon | 2026-11-17T00:00:00Z invocation failed\n',
      stderr: 'redis | 2026-11-17T00:00:01Z connection closed\n',
    })
    const logFile = path.join(logDir, 'cucumber-middleware.log')

    await captureMiddlewareLogs(logFile)

    expect(runCommandOrThrow).toHaveBeenCalledWith({
      command: 'docker',
      args: [
        'compose',
        '-f',
        middlewareComposeFile,
        '--profile',
        'postgresql',
        '--profile',
        'weaviate',
        'logs',
        '--no-color',
        '--timestamps',
      ],
      cwd: dockerDir,
      stdio: 'pipe',
    })
    expect(await readFile(logFile, 'utf8')).toContain('invocation failed\nredis |')
  })

  it.each(['compose', 'file'])(
    'warns without aborting cleanup when %s collection fails',
    async (failure) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const composeError = new Error('Compose unavailable')
      const logFilePath =
        failure === 'compose' ? path.join(logDir, 'cucumber-middleware.log') : logDir
      if (failure === 'compose') vi.mocked(runCommandOrThrow).mockRejectedValue(composeError)
      else vi.mocked(runCommandOrThrow).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

      await expect(captureMiddlewareLogs(logFilePath)).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(
        'Failed to capture middleware logs:',
        failure === 'compose' ? composeError : expect.objectContaining({ code: 'EISDIR' }),
      )
      if (failure === 'compose') expect(warn.mock.calls[0]?.[1]).toBe(composeError)
    },
  )
})
