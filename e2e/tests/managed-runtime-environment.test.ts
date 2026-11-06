import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { isTcpPortReachable, runCommand, runForegroundProcess } from '../scripts/common.ts'
import {
  getAgentBackendEnvironment,
  getManagedSandboxEnvironment,
  startShellctlSandbox,
} from '../scripts/setup.ts'

vi.mock('../scripts/common.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scripts/common.ts')>()),
  getTcpPortListenerDescription: vi.fn().mockResolvedValue(''),
  isTcpPortReachable: vi.fn().mockResolvedValue(false),
  runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  runForegroundProcess: vi.fn(),
}))

describe('managed runtime environment', () => {
  beforeEach(() => {
    for (const key of [
      'E2E_SHELLCTL_AUTH_TOKEN',
      'DIFY_AGENT_SHELLCTL_AUTH_TOKEN',
      'DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN',
      'DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT',
      'E2E_SHELLCTL_URL',
      'DIFY_AGENT_SHELLCTL_ENTRYPOINT',
    ])
      vi.stubEnv(key, '')
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses separate host and Sandbox API addresses', async () => {
    vi.stubEnv('DIFY_AGENT_INNER_API_URL', '')
    vi.stubEnv('DIFY_AGENT_SANDBOX_FILES_BASE_URL', '')

    await expect(getAgentBackendEnvironment()).resolves.toMatchObject({
      DIFY_AGENT_INNER_API_URL: 'http://127.0.0.1:5001',
      DIFY_AGENT_SANDBOX_FILES_BASE_URL: 'http://host.docker.internal:5001',
    })
  })

  it('preserves an explicit Sandbox-reachable API address', async () => {
    vi.stubEnv('DIFY_AGENT_SANDBOX_FILES_BASE_URL', 'https://dify.example.test/base')

    await expect(getAgentBackendEnvironment()).resolves.toMatchObject({
      DIFY_AGENT_SANDBOX_FILES_BASE_URL: 'https://dify.example.test/base',
    })
  })

  it('generates a fresh nonblank token for each self-managed lifecycle', () => {
    const first = getManagedSandboxEnvironment()
    const second = getManagedSandboxEnvironment()

    expect(first.E2E_SHELLCTL_AUTH_TOKEN).toMatch(/^[\da-f]{64}$/)
    expect(first.DIFY_AGENT_SHELLCTL_AUTH_TOKEN).toBe(first.E2E_SHELLCTL_AUTH_TOKEN)
    expect(second.E2E_SHELLCTL_AUTH_TOKEN).not.toBe(first.E2E_SHELLCTL_AUTH_TOKEN)
    expect(process.env.E2E_SHELLCTL_AUTH_TOKEN).toBe('')
  })

  it('preserves the explicit E2E token over a different Agent token', async () => {
    vi.stubEnv('E2E_SHELLCTL_AUTH_TOKEN', ' explicit-token ')
    vi.stubEnv('DIFY_AGENT_SHELLCTL_AUTH_TOKEN', 'other-token')
    vi.stubEnv('DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN', 'canonical-other-token')

    expect(getManagedSandboxEnvironment()).toEqual({
      E2E_SHELLCTL_AUTH_TOKEN: ' explicit-token ',
      DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN: ' explicit-token ',
      DIFY_AGENT_SHELLCTL_AUTH_TOKEN: ' explicit-token ',
    })
    await expect(getAgentBackendEnvironment()).resolves.toMatchObject({
      DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN: ' explicit-token ',
      DIFY_AGENT_SHELLCTL_AUTH_TOKEN: ' explicit-token ',
    })
  })

  it.each([
    'E2E_SHELLCTL_URL',
    'DIFY_AGENT_SHELLCTL_ENTRYPOINT',
    'DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT',
  ])('requires and preserves real credentials for an existing sandbox via %s', (key) => {
    vi.stubEnv(key, 'http://sandbox.example.test')
    expect(() => getManagedSandboxEnvironment()).toThrow('required for an existing sandbox')

    vi.stubEnv('DIFY_AGENT_SHELLCTL_AUTH_TOKEN', 'existing-token')
    expect(getManagedSandboxEnvironment()).toEqual({
      E2E_SHELLCTL_AUTH_TOKEN: 'existing-token',
      DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN: 'existing-token',
      DIFY_AGENT_SHELLCTL_AUTH_TOKEN: 'existing-token',
    })
  })

  it('rejects a whitespace-only token without including credentials in the error', () => {
    vi.stubEnv('E2E_SHELLCTL_AUTH_TOKEN', ' \t ')
    vi.stubEnv('DIFY_AGENT_SHELLCTL_AUTH_TOKEN', 'secret-do-not-log')
    expect(() => getManagedSandboxEnvironment()).toThrow('nonblank')
    expect(() => getManagedSandboxEnvironment()).not.toThrow('secret-do-not-log')
  })

  it('passes Docker the token through the environment rather than command arguments', async () => {
    vi.stubEnv('E2E_SHELLCTL_AUTH_TOKEN', 'secret-do-not-log')
    await startShellctlSandbox()

    expect(runForegroundProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['-e', 'SHELLCTL_AUTH_TOKEN']),
        env: { SHELLCTL_AUTH_TOKEN: 'secret-do-not-log' },
      }),
    )

    expect(vi.mocked(runForegroundProcess).mock.calls[0]![0].args.join(' ')).not.toContain(
      'secret-do-not-log',
    )
  })

  it('does not remove or replace a sandbox on an occupied port', async () => {
    vi.mocked(isTcpPortReachable).mockResolvedValueOnce(true)
    await expect(startShellctlSandbox()).rejects.toThrow('already in use')
    expect(runCommand).not.toHaveBeenCalled()
    expect(runForegroundProcess).not.toHaveBeenCalled()
  })

  it('uses the canonical Agent credential for an existing sandbox', async () => {
    vi.stubEnv('DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT', 'http://sandbox.example.test')
    vi.stubEnv('DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN', 'canonical-token')
    vi.stubEnv('DIFY_AGENT_SHELLCTL_AUTH_TOKEN', 'legacy-token')

    expect(getManagedSandboxEnvironment().E2E_SHELLCTL_AUTH_TOKEN).toBe('canonical-token')
    await expect(getAgentBackendEnvironment()).resolves.toMatchObject({
      DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN: 'canonical-token',
      DIFY_AGENT_SHELLCTL_AUTH_TOKEN: 'canonical-token',
    })
  })
})
