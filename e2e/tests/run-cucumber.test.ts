import type { ManagedProcess } from '../support/process.ts'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { runCommand } from '../scripts/common.ts'
import { runCucumber } from '../scripts/run-cucumber.ts'
import {
  getManagedSandboxEnvironment,
  resetState,
  startMiddleware,
  stopMiddleware,
} from '../scripts/setup.ts'
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
  getManagedSandboxEnvironment: vi.fn(),
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
    vi.stubEnv('E2E_AGENT_BACKEND_URL', '')
    vi.stubEnv('AGENT_BACKEND_BASE_URL', '')
    vi.stubEnv('E2E_SHELLCTL_URL', '')
    vi.stubEnv('DIFY_AGENT_SHELLCTL_ENTRYPOINT', '')
    vi.stubEnv('DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT', '')
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

  it('resolves one token and forwards it to both setup children and Cucumber', async () => {
    vi.stubEnv('E2E_START_AGENT_BACKEND', '1')
    const environment = {
      E2E_SHELLCTL_AUTH_TOKEN: 'one-lifecycle-token',
      DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN: 'one-lifecycle-token',
      DIFY_AGENT_SHELLCTL_AUTH_TOKEN: 'one-lifecycle-token',
    }
    vi.mocked(getManagedSandboxEnvironment).mockReturnValue(environment)

    await runCucumber([])

    expect(getManagedSandboxEnvironment).toHaveBeenCalledOnce()
    for (const command of ['shellctl-sandbox', 'agent-backend']) {
      expect(startLoggedProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['./scripts/setup.ts', command],
          env: expect.objectContaining(environment),
        }),
      )
    }
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ env: expect.objectContaining(environment) }),
    )
  })

  it('does not start or stop an independently managed sandbox', async () => {
    vi.stubEnv('E2E_START_AGENT_BACKEND', '1')
    vi.stubEnv('E2E_SHELLCTL_URL', 'http://existing.example.test')
    vi.mocked(getManagedSandboxEnvironment).mockReturnValue({
      E2E_SHELLCTL_AUTH_TOKEN: 'existing-token',
      DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN: 'existing-token',
      DIFY_AGENT_SHELLCTL_AUTH_TOKEN: 'existing-token',
    })

    await runCucumber([])

    expect(startLoggedProcess).not.toHaveBeenCalledWith(
      expect.objectContaining({ args: ['./scripts/setup.ts', 'shellctl-sandbox'] }),
    )
    expect(startLoggedProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['./scripts/setup.ts', 'agent-backend'],
        env: expect.objectContaining({ DIFY_AGENT_SHELLCTL_AUTH_TOKEN: 'existing-token' }),
      }),
    )
  })

  it('fails before resetting or starting services when sandbox credentials are invalid', async () => {
    vi.stubEnv('E2E_START_AGENT_BACKEND', '1')
    vi.mocked(getManagedSandboxEnvironment).mockImplementation(() => {
      throw new Error('sandbox credentials required')
    })

    await expect(runCucumber(['--full'])).rejects.toThrow('sandbox credentials required')
    expect(resetState).not.toHaveBeenCalled()
    expect(startLoggedProcess).not.toHaveBeenCalled()
  })
})
