import { describe, expect, it, vi } from 'vite-plus/test'
import { runStartupStages } from '../support/startup-stages'

const deferred = () => {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('runStartupStages', () => {
  it('overlaps startup while waiting for every service before returning', async () => {
    const backend = deferred()
    const web = deferred()
    const backendStart = vi.fn(() => backend.promise)
    const webStart = vi.fn(() => web.promise)
    const finished = vi.fn()
    const startup = runStartupStages(
      [
        { label: 'backend', run: backendStart },
        { label: 'web', run: webStart },
      ],
      true,
    ).then(finished)

    expect(backendStart).toHaveBeenCalledOnce()
    expect(webStart).toHaveBeenCalledOnce()
    backend.resolve()
    await backend.promise
    expect(finished).not.toHaveBeenCalled()
    web.resolve()
    await startup
    expect(finished).toHaveBeenCalledOnce()
  })

  it('waits for the other startup branch after failure so teardown cannot race it', async () => {
    const web = deferred()
    const failure = new Error('backend failed')
    const settled = vi.fn()
    const startup = runStartupStages(
      [
        {
          label: 'backend',
          run: async () => {
            throw failure
          },
        },
        { label: 'web', run: () => web.promise },
      ],
      true,
    ).catch(settled)

    await Promise.resolve()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    web.resolve()
    await startup
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ errors: [failure] }))
  })

  it('preserves sequential startup and stops on failure when the experiment is disabled', async () => {
    const backend = deferred()
    const webStart = vi.fn()
    const failure = new Error('backend failed')
    const startup = runStartupStages(
      [
        { label: 'backend', run: () => backend.promise },
        { label: 'web', run: webStart },
      ],
      false,
    )
    const rejection = expect(startup).rejects.toThrow(failure)
    expect(webStart).not.toHaveBeenCalled()
    backend.reject(failure)
    await rejection
    expect(webStart).not.toHaveBeenCalled()
  })
})
