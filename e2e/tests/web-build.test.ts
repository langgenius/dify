import type { ManagedProcess } from '../support/process.ts'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { startLoggedProcess } from '../support/process.ts'
import { startWebBuildDownload } from '../support/web-build.ts'

vi.mock('../support/process.ts', () => ({ startLoggedProcess: vi.fn() }))

describe('managed Web build download', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const start = async () => {
    const childProcess = new EventEmitter()
    const process = {
      childProcess,
      logFilePath: '/logs/cucumber-web-build.log',
    } as unknown as ManagedProcess
    vi.mocked(startLoggedProcess).mockResolvedValue(process)
    return { childProcess, download: await startWebBuildDownload('/logs'), process }
  }

  it('keeps the process available for cleanup and waits for successful completion', async () => {
    const { childProcess, download, process } = await start()
    expect(download.process).toBe(process)
    childProcess.emit('close', 0)
    await expect(download.completed).resolves.toBeUndefined()
  })

  it.each([1, null])(
    'records failed or signalled completion (%s) before the runner joins',
    async (code) => {
      const { childProcess, download } = await start()
      childProcess.emit('close', code)
      await expect(download.completed).resolves.toEqual(
        expect.objectContaining({
          message: expect.stringContaining('/logs/cucumber-web-build.log'),
        }),
      )
    },
  )

  it('captures spawn errors without emitting an unhandled rejection during backend startup', async () => {
    const { childProcess, download } = await start()
    const error = new Error('spawn failed')
    childProcess.emit('error', error)
    await expect(download.completed).resolves.toBe(error)
  })
})
