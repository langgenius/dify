import { toast } from '@langgenius/dify-ui/toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
// oxlint-disable-next-line no-restricted-imports -- Exercise the shared request transport and its notification behavior.
import { base } from '../fetch'
import { clearRequestErrorToasts, notifyRequestError } from '../request-error-toast'

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: vi.fn() },
}))

describe('request error toast timer lifecycle', () => {
  const request = { method: 'GET', url: 'https://example.com/apps' }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('expires by wall clock even when the timer callback has not run', () => {
    notifyRequestError(request, 'A')

    vi.setSystemTime(Date.now() + 10000)
    notifyRequestError(request, 'A')

    expect(vi.mocked(toast.error).mock.calls).toEqual([['A'], ['A']])
  })

  it('keeps a reopened window active past the cleared window’s old deadline', async () => {
    notifyRequestError(request, 'A')
    await vi.advanceTimersByTimeAsync(2000)
    clearRequestErrorToasts(request)
    notifyRequestError(request, 'A')

    await vi.advanceTimersByTimeAsync(8000)
    notifyRequestError(request, 'A')
    expect(toast.error).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(2000)
    notifyRequestError(request, 'A')
    expect(toast.error).toHaveBeenCalledTimes(3)
  })

  it('expires staggered messages independently', async () => {
    notifyRequestError(request, 'A')
    await vi.advanceTimersByTimeAsync(2000)
    notifyRequestError(request, 'B')

    await vi.advanceTimersByTimeAsync(8000)
    notifyRequestError(request, 'A')
    notifyRequestError(request, 'B')
    expect(vi.mocked(toast.error).mock.calls).toEqual([['A'], ['B'], ['A']])

    await vi.advanceTimersByTimeAsync(2000)
    notifyRequestError(request, 'A')
    notifyRequestError(request, 'B')
    expect(vi.mocked(toast.error).mock.calls).toEqual([['A'], ['B'], ['A'], ['B']])
  })
})

const errorResponse = (message = 'Unavailable', status = 500) =>
  new Response(JSON.stringify({ message, status }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const expectError = async (...args: Parameters<typeof base>) => {
  await expect(base(...args)).rejects.toMatchObject({ status: 500 })
}

describe('request error toast deduplication', () => {
  const network = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    network.mockReset()
    network.mockImplementation(async () => errorResponse())
    vi.stubGlobal('fetch', network)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows immediately and again at 10000ms without extending the window for suppressed errors', async () => {
    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable')

    await vi.advanceTimersByTimeAsync(5000)
    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledTimes(1)

    // Reach 9999ms from the last displayed toast.
    await vi.advanceTimersByTimeAsync(4999)
    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledTimes(2)

    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(network).toHaveBeenCalledTimes(5)
  })

  it('shows each distinct message while suppressing a previously shown message', async () => {
    network
      .mockResolvedValueOnce(errorResponse('A'))
      .mockResolvedValueOnce(errorResponse('B'))
      .mockResolvedValueOnce(errorResponse('A'))

    await expectError('/apps')
    await expectError('/apps')
    await expectError('/apps')

    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenNthCalledWith(1, 'A')
    expect(toast.error).toHaveBeenNthCalledWith(2, 'B')
  })

  it.each([
    ['URL', '/datasets', {}],
    ['query params', '/apps', { params: { page: 2 } }],
  ] as const)(
    'shows the same message independently for a different %s',
    async (_, url, options) => {
      await expectError('/apps')
      await expectError(url, options)
      await expectError('/apps')
      await expectError(url, options)

      expect(toast.error).toHaveBeenCalledTimes(2)
      expect(toast.error).toHaveBeenNthCalledWith(1, 'Unavailable')
      expect(toast.error).toHaveBeenNthCalledWith(2, 'Unavailable')
    },
  )

  it('shows every POST, PUT, PATCH, and DELETE error even while the same GET error is suppressed', async () => {
    await expectError('/apps')
    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable')

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const previousCount = vi.mocked(toast.error).mock.calls.length
      await expectError('/apps', { method })
      await expectError('/apps', { method })
      expect(toast.error).toHaveBeenCalledTimes(previousCount + 2)
      expect(toast.error).toHaveBeenNthCalledWith(previousCount + 1, 'Unavailable')
      expect(toast.error).toHaveBeenNthCalledWith(previousCount + 2, 'Unavailable')
    }

    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledTimes(9)
  })

  it('clears all messages after success only for the successful request', async () => {
    await expectError('/datasets')
    network
      .mockResolvedValueOnce(errorResponse('A'))
      .mockResolvedValueOnce(errorResponse('B'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'success' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(errorResponse('A'))
      .mockResolvedValueOnce(errorResponse('B'))

    await expectError('/apps')
    await expectError('/apps')
    await expect(base('/apps')).resolves.toEqual({ result: 'success' })
    await expectError('/apps')
    await expectError('/apps')
    await expectError('/datasets')

    expect(vi.mocked(toast.error).mock.calls).toEqual([['Unavailable'], ['A'], ['B'], ['A'], ['B']])
  })

  it('keeps silent errors silent without suppressing the next visible error', async () => {
    await expectError('/apps', {}, { silent: true })
    expect(toast.error).not.toHaveBeenCalled()

    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable')
  })

  it('suppresses 401 toasts without suppressing a subsequent non-401 error with the same message', async () => {
    network.mockResolvedValueOnce(errorResponse('Unavailable', 401))

    await expect(base('/apps')).rejects.toMatchObject({ status: 401 })
    expect(toast.error).not.toHaveBeenCalled()

    await expectError('/apps')
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable')
  })
})
