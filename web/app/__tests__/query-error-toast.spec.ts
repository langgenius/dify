import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { captureAppAccessScope, handleAppAccessError } from '@/features/app-access-error/state'
import { createHttpError } from '@/service/http-error'
import { toastRequestError } from '../query-error-toast'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const httpError = (status: number, body?: unknown) =>
  createHttpError({ status, statusText: '', headers: new Headers() }, body)

describe('toastRequestError', () => {
  afterEach(() => {
    vi.mocked(toast.error).mockClear()
  })

  it('reports a failed request with the server message or a custom one', () => {
    toastRequestError(httpError(400, { message: 'Invalid name' }))
    toastRequestError(httpError(500), 'Could not save')

    expect(vi.mocked(toast.error).mock.calls).toEqual([['Invalid name'], ['Could not save']])
  })

  it('falls back to a default message when the server sends none', () => {
    toastRequestError(httpError(502))

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('api.actionFailed'))
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
    ['the request never reached the server', new TypeError('Failed to fetch')],
  ])('does not report when %s', (_case, error) => {
    toastRequestError(error)

    expect(toast.error).not.toHaveBeenCalled()
  })
})
