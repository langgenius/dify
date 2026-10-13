import { ORPCError } from '@orpc/client'
import { waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- This test exercises the transport boundary directly.
import { sseGeneratorPost, sseGet, ssePost } from '../base'
import { StreamError } from '../stream-error'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('../refresh-token', () => ({ refreshAccessTokenOrReLogin: refresh }))

const streams = [
  { name: 'POST', start: ssePost },
  { name: 'GET reconnect', start: sseGet },
  { name: 'generator', start: sseGeneratorPost },
]

const streamResponse = (chunks: string[], cancel = vi.fn()) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      },
      cancel,
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

afterEach(() => {
  vi.restoreAllMocks()
  refresh.mockReset()
  Cookies.remove(CSRF_COOKIE_NAME())
})

describe.each(streams)('$name error contract', ({ start }) => {
  it.each([
    {
      body: JSON.stringify({
        message: 'Slow down',
        code: 'too_many_requests',
        hint: 'Retry later',
        details: { quota: 1 },
      }),
      status: 429,
      message: 'Slow down',
    },
    { body: '<html>upstream down</html>', status: 502, message: 'Bad Gateway' },
    { body: '', status: 503, message: 'Service Unavailable' },
  ])('preserves an actual HTTP $status failure', async ({ body, status, message }) => {
    const onError = vi.fn()
    const response = new Response(body, {
      status,
      statusText: message,
      headers: { 'Retry-After': '23' },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
    start('/stream', {}, { onError })
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    const error = onError.mock.calls[0]![0]
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ status, message })
    expect(error.cause).toEqual({ headers: response.headers })
    if (status === 429)
      expect(error).toMatchObject({
        code: 'too_many_requests',
        data: { hint: 'Retry later', details: { quota: 1 } },
      })
  })

  it('preserves stream metadata and stops after the first error frame', async () => {
    const onError = vi.fn()
    const onCompleted = vi.fn()
    const cancel = vi.fn()
    const payload = {
      event: 'error',
      message: 'Model unavailable',
      code: 'model_not_found',
      reason: 'disabled',
      hint: 'Choose another model',
      details: { model: 'old' },
    }
    const frame = `data: ${JSON.stringify(payload)}\n\n`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      streamResponse([frame.slice(0, 16), frame.slice(16) + frame], cancel),
    )
    start('/stream', {}, { onError, onCompleted })
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(StreamError)
    expect(onError.mock.calls[0]![0]).toMatchObject({
      message: payload.message,
      code: payload.code,
      reason: payload.reason,
      hint: payload.hint,
      details: payload.details,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(onCompleted).not.toHaveBeenCalledWith()
  })

  it('retries authentication once with the original signal, then reports the HTTP failure', async () => {
    refresh.mockImplementation(async () => {
      Cookies.set(CSRF_COOKIE_NAME(), 'refreshed-csrf')
    })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        Response.json({ code: 'unauthorized', message: 'Session expired' }, { status: 401 }),
      )
    const onError = vi.fn()
    const getAbortController = vi.fn()
    start('/stream', {}, { onError, getAbortController })
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(ORPCError)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(getAbortController).toHaveBeenCalledTimes(1)
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get(CSRF_HEADER_NAME)).toBe(
      'refreshed-csrf',
    )
    expect(fetch.mock.calls[1]![1]?.signal).toBe(fetch.mock.calls[0]![1]?.signal)
  })

  it('does not reconnect when cancelled during authentication refresh', async () => {
    let finishRefresh!: () => void
    refresh.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve
      }),
    )
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
    const onError = vi.fn()
    let controller!: AbortController
    start(
      '/stream',
      {},
      {
        onError,
        getAbortController: (value) => {
          controller = value
        },
      },
    )
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    controller.abort()
    finishRefresh()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledTimes(1)
    // Generator cancellation has no callback by contract; other owners receive AbortError for cleanup.
    if (start === sseGeneratorPost) expect(onError).not.toHaveBeenCalled()
    else
      expect(onError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: 'AbortError' }),
      )
  })
})
