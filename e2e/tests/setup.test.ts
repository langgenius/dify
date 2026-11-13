import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { dockerDir, middlewareComposeFile, runCommandOrThrow } from '../scripts/common.ts'
import { captureMiddlewareLogs } from '../scripts/setup.ts'

vi.mock('../scripts/env-register.ts', () => ({}))
vi.mock('node:fs/promises', () => ({ writeFile: vi.fn() }))
vi.mock('../scripts/common.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scripts/common.ts')>()),
  isMainModule: () => false,
  runCommandOrThrow: vi.fn(),
}))

describe('middleware log capture', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('saves timestamped logs with the same Compose file and profiles as middleware startup', async () => {
    vi.mocked(runCommandOrThrow).mockResolvedValue({
      exitCode: 0,
      stdout: 'daemon logs\n',
      stderr: 'warnings\n',
    })
    await captureMiddlewareLogs('/logs/cucumber-middleware.log')

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
    expect(writeFile).toHaveBeenCalledWith(
      '/logs/cucumber-middleware.log',
      'daemon logs\nwarnings\n',
      'utf8',
    )
  })

  it.each(['command', 'write'])(
    'warns and resolves when %s fails so teardown can continue',
    async (failure) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(runCommandOrThrow).mockResolvedValue({ exitCode: 0, stdout: 'logs', stderr: '' })
      if (failure === 'command')
        vi.mocked(runCommandOrThrow).mockRejectedValueOnce(new Error('Docker unavailable'))
      else vi.mocked(writeFile).mockRejectedValueOnce(new Error('disk full'))

      await expect(captureMiddlewareLogs('/logs/cucumber-middleware.log')).resolves.toBeUndefined()
      expect(warning).toHaveBeenCalledOnce()
    },
  )
})
