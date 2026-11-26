import { ORPCError } from '@orpc/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { captureAppAccessScope, handleAppAccessError } from '@/features/app-access-error/state'
import { markErrorHandled } from '@/service/handled-error'
import { createHttpError } from '@/service/http-error'
import { getQueryClient } from '../get-query-client'
import { toastRequestError } from '../query-error-toast'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const httpError = (status: number, body?: unknown) =>
  createHttpError({ status, statusText: '', headers: new Headers() }, body)

let keyIndex = 0
const nextKey = () => ['query-error-toast', keyIndex++]

describe('query cache error toasts', () => {
  const queryClient = getQueryClient()

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    queryClient.clear()
  })

  const loadThenFail = async (error: unknown, meta?: { errorToast?: false }) => {
    const queryKey = nextKey()
    const queryFn = vi.fn().mockResolvedValueOnce('cached').mockRejectedValue(error)
    await queryClient.query({ queryKey, queryFn, meta })
    await queryClient.refetchQueries({ queryKey })
    return { queryKey, queryFn }
  }

  it('reports a failed first load with the server message', async () => {
    await expect(
      queryClient.query({
        queryKey: nextKey(),
        queryFn: () => Promise.reject(httpError(500, { message: 'Unavailable' })),
      }),
    ).rejects.toBeInstanceOf(ORPCError)

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable')
  })

  it('leaves a failed first load to an owner that renders its own error state', async () => {
    await expect(
      queryClient.query({
        queryKey: nextKey(),
        queryFn: () => Promise.reject(httpError(500, { message: 'Unavailable' })),
        meta: { errorToast: false },
      }),
    ).rejects.toBeInstanceOf(ORPCError)

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports a failed background refetch with the server message', async () => {
    await loadThenFail(httpError(500, { message: 'Unavailable' }))

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable')
  })

  it('reports a failing poll once per window and again after it recovers', async () => {
    const queryKey = nextKey()
    // Every failed fetch is a new error.
    const error = () => httpError(503, { message: 'Down' })
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce('cached')
      .mockRejectedValueOnce(error())
      .mockRejectedValueOnce(error())
      .mockResolvedValueOnce('recovered')
      .mockRejectedValueOnce(error())
    await queryClient.query({ queryKey, queryFn })

    await queryClient.refetchQueries({ queryKey })
    vi.setSystemTime(Date.now() + 1000)
    await queryClient.refetchQueries({ queryKey })
    expect(toast.error).toHaveBeenCalledOnce()

    await queryClient.refetchQueries({ queryKey })
    await queryClient.refetchQueries({ queryKey })
    expect(toast.error).toHaveBeenCalledTimes(2)
  })

  it('drops the dedupe window of a removed query', async () => {
    const queryKey = nextKey()
    const fail = () => Promise.reject(httpError(503, { message: 'Down' }))
    await queryClient.query({ queryKey, queryFn: fail }).catch(() => {})
    queryClient.removeQueries({ queryKey })
    await queryClient.query({ queryKey, queryFn: fail }).catch(() => {})

    expect(toast.error).toHaveBeenCalledTimes(2)
  })

  it('reports the same message again once its window expires', async () => {
    const queryKey = nextKey()
    const fail = () => Promise.reject(httpError(503, { message: 'Down' }))
    await queryClient.query({ queryKey, queryFn: fail, staleTime: 0 }).catch(() => {})
    vi.setSystemTime(Date.now() + 10_000)
    await queryClient.query({ queryKey, queryFn: fail, staleTime: 0 }).catch(() => {})

    expect(toast.error).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['meta opts out', httpError(500, { message: 'Unavailable' }), { errorToast: false as const }],
    ['the session expired', httpError(401, { message: 'Unauthorized' }), undefined],
    ['the body has no message', httpError(502), undefined],
    ['the error is not a request error', new Error('Render failed'), undefined],
  ])('does not report a background refetch when %s', async (_case, error, meta) => {
    await loadThenFail(error, meta)

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not report an error the request layer already handled', async () => {
    const error = httpError(403, { message: 'Access denied' })
    markErrorHandled(error)
    // The defined-error interceptor rebuilds the error with the same cause.
    const rebuilt = new ORPCError(error.code, {
      status: error.status,
      message: error.message,
      data: error.data,
      cause: error.cause,
    })

    await loadThenFail(rebuilt)

    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('mutation cache error toasts', () => {
  const queryClient = getQueryClient()

  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
  })

  const mutate = (error: unknown, meta?: { errorToast?: false; errorMessage?: string }) =>
    queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => Promise.reject(error), meta })
      .execute(undefined)
      .catch(() => {})

  it('reports a failed write with the server message', async () => {
    await mutate(httpError(409, { message: 'Name already exists' }))

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Name already exists')
  })

  it('reports a nested mutation failure once', async () => {
    const error = httpError(409, { message: 'Version conflict' })
    const inner = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => Promise.reject(error) })
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => inner.execute(undefined) })
      .execute(undefined)
      .catch(() => {})

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Version conflict')
  })

  it('does not report a query failure again when a mutation rethrows it', async () => {
    const error = httpError(500, { message: 'Unavailable' })
    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: () =>
          queryClient.query({
            queryKey: ['nested-query-failure'],
            queryFn: () => Promise.reject(error),
          }),
      })
      .execute(undefined)
      .catch(() => {})

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable')
  })

  it('reports every failed write, even with the same message', async () => {
    await mutate(httpError(409, { message: 'Name already exists' }))
    await mutate(httpError(409, { message: 'Name already exists' }))

    expect(toast.error).toHaveBeenCalledTimes(2)
  })

  it('falls back to a default message when the server sends none', async () => {
    await mutate(httpError(502))

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('api.actionFailed'))
  })

  it('uses the custom message from meta', async () => {
    await mutate(httpError(500, { message: 'Unavailable' }), { errorMessage: 'Could not save' })

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Could not save')
  })

  it('lets the owner present the failure through the meta opt-out', async () => {
    await mutate(httpError(400, { message: 'Invalid name' }), { errorToast: false })

    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['the session expired', httpError(401, { message: 'Unauthorized' })],
    ['the error is not a request error', new TypeError('Failed to fetch')],
  ])('does not report a failed write when %s', async (_case, error) => {
    await mutate(error)

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not report an error the request layer already handled', async () => {
    const error = httpError(404, { message: 'App not found' })
    markErrorHandled(error)

    await mutate(error)

    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('toastRequestError', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
  })

  it('reports a failed request awaited outside TanStack Query like a failed mutation', () => {
    toastRequestError(httpError(400, { message: 'Invalid name' }))
    toastRequestError(httpError(500), 'Could not save')

    expect(vi.mocked(toast.error).mock.calls).toEqual([['Invalid name'], ['Could not save']])
  })

  it('does not report a failure the app-access page already presents', () => {
    window.history.replaceState({}, '', '/chat/app')
    const data = { code: 'ip_access_denied', message: 'Access denied' }
    const error = httpError(403, data)

    expect(handleAppAccessError(403, data, captureAppAccessScope(), error)).toBe(true)
    toastRequestError(error)

    expect(toast.error).not.toHaveBeenCalled()
    window.history.replaceState({}, '', '/')
  })

  it.each([
    ['the session expired', httpError(401, { message: 'Unauthorized' })],
    ['the error is not a request error', new DOMException('Aborted', 'AbortError')],
  ])('does not report when %s', (_case, error) => {
    toastRequestError(error)

    expect(toast.error).not.toHaveBeenCalled()
  })
})
