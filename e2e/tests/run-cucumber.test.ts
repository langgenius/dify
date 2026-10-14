import type { ManagedProcess } from '../support/process.ts'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { runCommand } from '../scripts/common.ts'
import { runCucumber } from '../scripts/run-cucumber.ts'
import { resetState, startMiddleware, stopMiddleware } from '../scripts/setup.ts'
import { startLoggedProcess, stopManagedProcess, waitForUrl } from '../support/process.ts'
import { startWebBuildDownload } from '../support/web-build.ts'
import { startWebServer, stopWebServer } from '../support/web-server.ts'

vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), readFile: vi.fn(), rm: vi.fn() }))
vi.mock('../scripts/env-register.ts', () => ({}))
vi.mock('../scripts/seed-runner.ts', () => ({ runSeed: vi.fn() }))
vi.mock('../scripts/common.ts', () => ({
  e2eDir: '/e2e',
  isMainModule: () => false,
  runCommand: vi.fn(),
}))
vi.mock('../scripts/setup.ts', () => ({
  resetState: vi.fn(),
  startMiddleware: vi.fn(),
  stopMiddleware: vi.fn(),
}))
vi.mock('../support/process.ts', () => ({
  startLoggedProcess: vi.fn(),
  stopManagedProcess: vi.fn(),
  waitForUrl: vi.fn(),
}))
vi.mock('../support/web-build.ts', () => ({ startWebBuildDownload: vi.fn() }))
vi.mock('../support/web-server.ts', () => ({ startWebServer: vi.fn(), stopWebServer: vi.fn() }))
vi.mock('../test-env.ts', () => ({
  apiURL: 'http://localhost:5001',
  baseURL: 'http://localhost:3000',
  reuseExistingWebServer: false,
}))

const managedProcess = () =>
  ({
    childProcess: Object.assign(new EventEmitter(), { exitCode: null }),
    logFilePath: '/e2e/.logs/test.log',
    label: 'test process',
  }) as unknown as ManagedProcess

describe('core E2E preparation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('E2E_START_AGENT_BACKEND', '')
    vi.mocked(startLoggedProcess).mockImplementation(async () => managedProcess())
    vi.mocked(readFile).mockResolvedValue('{"testCaseStarted":{}}')
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.exitCode = undefined
  })

  it('starts the backend before the build is ready and joins before starting Web or Cucumber', async () => {
    let finishBuild!: () => void
    const completed = new Promise<Error | undefined>((resolve) => {
      finishBuild = () => resolve(undefined)
    })
    const downloadProcess = managedProcess()
    vi.mocked(startWebBuildDownload).mockResolvedValue({
      process: downloadProcess,
      completed,
    })

    const run = runCucumber(['--full', '--download-web-build', '--', '--shard', '2/3'])
    await vi.waitFor(() => expect(startLoggedProcess).toHaveBeenCalledTimes(2))
    expect(resetState).toHaveBeenCalledBefore(vi.mocked(startWebBuildDownload))
    expect(startWebBuildDownload).toHaveBeenCalledBefore(vi.mocked(startMiddleware))
    expect(waitForUrl).toHaveBeenCalledWith('http://localhost:5001/health', 180_000, 1_000)
    expect(startWebServer).not.toHaveBeenCalled()
    expect(runCommand).not.toHaveBeenCalled()

    finishBuild()
    await run
    expect(startWebServer).toHaveBeenCalledBefore(vi.mocked(runCommand))
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['--shard', '2/3']),
      }),
    )
    expect(stopManagedProcess).toHaveBeenCalledWith(downloadProcess)
    expect(stopWebServer).toHaveBeenCalledOnce()
    expect(stopMiddleware).toHaveBeenCalledOnce()
  })

  it('fails closed and tears down the backend when artifact preparation fails', async () => {
    const error = new Error('Web build producer failed')
    vi.mocked(startWebBuildDownload).mockResolvedValue({
      process: managedProcess(),
      completed: Promise.resolve(error),
    })

    await expect(runCucumber(['--full', '--download-web-build'])).rejects.toThrow(error)
    expect(startWebServer).not.toHaveBeenCalled()
    expect(runCommand).not.toHaveBeenCalled()
    expect(stopManagedProcess).toHaveBeenCalledTimes(5)
    expect(stopMiddleware).toHaveBeenCalledOnce()
  })

  it('stops an unfinished artifact download when backend startup fails', async () => {
    const downloadProcess = managedProcess()
    vi.mocked(startWebBuildDownload).mockResolvedValue({
      process: downloadProcess,
      completed: new Promise(() => {}),
    })
    vi.mocked(startMiddleware).mockRejectedValue(new Error('middleware failed'))

    await expect(runCucumber(['--full', '--download-web-build'])).rejects.toThrow(
      'middleware failed',
    )
    expect(stopManagedProcess).toHaveBeenCalledWith(downloadProcess)
    expect(stopMiddleware).toHaveBeenCalledOnce()
    expect(startWebServer).not.toHaveBeenCalled()
  })

  it('keeps local full runs independent of GitHub artifact preparation', async () => {
    await runCucumber(['--full'])
    expect(startWebBuildDownload).not.toHaveBeenCalled()
    expect(startWebServer).toHaveBeenCalledOnce()
    expect(runCommand).toHaveBeenCalledOnce()
  })

  it('preserves Cucumber failure and empty-selection gates after preparation', async () => {
    vi.mocked(startWebBuildDownload).mockResolvedValue({
      process: managedProcess(),
      completed: Promise.resolve(undefined),
    })
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' })
    await runCucumber(['--full', '--download-web-build'])
    expect(process.exitCode).toBe(1)

    vi.mocked(readFile).mockResolvedValue('')
    await expect(runCucumber(['--full', '--download-web-build'])).rejects.toThrow('zero scenarios')
  })
})
