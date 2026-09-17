import { toast } from '@langgenius/dify-ui/toast'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  captureIpAccessScope,
  ipAccessDeniedAtom,
  ipAccessStore,
  isIpAccessDeniedError,
} from '@/features/webapp-ip-access/state'
// oxlint-disable-next-line no-restricted-imports -- This integration spec exercises public WebApp transport error handling.
import { request, sseGet, ssePost, upload } from '../base'
import * as webAppAuth from '../webapp-auth'

const refreshAccessTokenOrReLogin = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('../refresh-token', () => ({ refreshAccessTokenOrReLogin }))

const denial = {
  code: 'ip_access_denied',
  message: 'Your IP address is not allowed.',
  status: 403,
  client_ip: '2001:db8::12',
}

const createResponse = (data: unknown, status = 403) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const createPendingResponse = () => {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((resolveResponse) => {
    resolve = resolveResponse
  })
  return { promise, resolve }
}

const createXhr = (data: unknown, status = 403) =>
  ({
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    send: vi.fn(function (this: { onreadystatechange?: () => void }) {
      this.onreadystatechange?.()
    }),
    status,
    response: data,
    readyState: 4,
    upload: {},
    withCredentials: false,
    responseType: '',
  }) as unknown as XMLHttpRequest

const transitionWhileRequestIsPending = async (transition: 'denied' | 'navigated') => {
  if (transition === 'denied') {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(createResponse(denial))
    const error = await request('/parameters', {}, { isPublicAPI: true }).catch(
      (caught: unknown) => caught,
    )
    expect(isIpAccessDeniedError(error)).toBe(true)
  } else {
    window.history.replaceState({}, '', '/environment/chat/another-app')
    captureIpAccessScope()
  }
}

describe('WebApp IP access denial transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    captureIpAccessScope()
    window.history.replaceState({}, '', '/chat/ip-restricted-app')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
    captureIpAccessScope()
  })

  it.each(['/site', '/webapp/access-mode', '/login/status', '/passport'])(
    'handles denied initialization request %s without consuming its body or changing the URL',
    async (path) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(createResponse(denial))
      const url = window.location.href
      let error: unknown

      try {
        await request(path, {}, { isPublicAPI: true })
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(Response)
      expect(isIpAccessDeniedError(error)).toBe(true)
      expect(ipAccessStore.get(ipAccessDeniedAtom)?.clientIp).toBe(denial.client_ip)
      await expect((error as Response).json()).resolves.toEqual(denial)
      expect(fetch).toHaveBeenCalledOnce()
      expect(window.location.href).toBe(url)
      expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('handles a denied HITL submission without a WebApp address', async () => {
    window.history.replaceState({}, '', '/form/ip-restricted-form')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(createResponse(denial))

    const error = await request(
      '/form/human_input/ip-restricted-form',
      { method: 'POST', body: { action: 'approve' } },
      { isPublicAPI: true },
    ).catch((caught: unknown) => caught)

    expect(isIpAccessDeniedError(error)).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
    expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('does not publish a late rejection for the previous App', async () => {
    const pending = createPendingResponse()
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise)
    const response = request('/site', {}, { isPublicAPI: true }).catch((error: unknown) => error)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce())

    window.history.replaceState({}, '', '/chat/another-app')
    captureIpAccessScope()
    pending.resolve(createResponse(denial))

    expect(isIpAccessDeniedError(await response)).toBe(true)
    expect(ipAccessStore.get(ipAccessDeniedAtom)).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  describe('concurrent authorization responses', () => {
    beforeEach(() => {
      window.history.replaceState({}, '', '/environment/chat/ip-restricted-app')
    })

    it.each([
      { transition: 'denied' as const, status: 401, code: 'unauthorized' },
      { transition: 'navigated' as const, status: 401, code: 'unauthorized' },
      { transition: 'denied' as const, status: 403, code: 'web_app_access_denied' },
      { transition: 'navigated' as const, status: 403, code: 'web_app_access_denied' },
      { transition: 'denied' as const, status: 401, code: null },
      { transition: 'navigated' as const, status: 401, code: null },
    ])(
      'ignores late JSON $status/$code auth recovery after the page is $transition',
      async ({ transition, status, code }) => {
        const pending = createPendingResponse()
        const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise)
        const beginRecovery = vi.spyOn(webAppAuth, 'beginWebAppAuthorizationRecovery')
        const clearPassport = vi.spyOn(webAppAuth, 'clearWebAppPassport')
        const response = request('/meta', {}, { isPublicAPI: true }).catch(
          (error: unknown) => error,
        )
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce())

        await transitionWhileRequestIsPending(transition)
        const url = window.location.href
        const currentDenial = ipAccessStore.get(ipAccessDeniedAtom)
        pending.resolve(
          code
            ? createResponse({ code, message: 'Late authorization error' }, status)
            : new Response('not JSON', { status }),
        )

        expect(await response).toBeInstanceOf(Response)
        expect(window.location.href).toBe(url)
        expect(ipAccessStore.get(ipAccessDeniedAtom)).toBe(currentDenial)
        expect(beginRecovery).not.toHaveBeenCalled()
        expect(clearPassport).not.toHaveBeenCalled()
        expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
        expect(toast.error).not.toHaveBeenCalled()
      },
    )

    it.each(['denied', 'navigated'] as const)(
      'does not complete auth recovery from a successful response after the page is %s',
      async (transition) => {
        const pending = createPendingResponse()
        const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise)
        const completeRecovery = vi.spyOn(webAppAuth, 'completeWebAppAuthorizationRecovery')
        const response = request('/site', {}, { isPublicAPI: true })
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce())

        await transitionWhileRequestIsPending(transition)
        pending.resolve(createResponse({ result: 'ok' }, 200))

        await expect(response).resolves.toEqual({ result: 'ok' })
        expect(completeRecovery).not.toHaveBeenCalled()
      },
    )

    it.each([
      { transition: 'denied' as const, stream: ssePost, name: 'POST' },
      { transition: 'navigated' as const, stream: ssePost, name: 'POST' },
      { transition: 'denied' as const, stream: sseGet, name: 'GET' },
      { transition: 'navigated' as const, stream: sseGet, name: 'GET' },
    ])(
      'settles a late SSE $name authorization failure after the page is $transition',
      async ({ transition, stream }) => {
        const pending = createPendingResponse()
        vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise)
        const beginRecovery = vi.spyOn(webAppAuth, 'beginWebAppAuthorizationRecovery')
        const onError = vi.fn()
        const onNotifyError = vi.fn()
        await stream('/chat-messages', {}, { isPublicAPI: true, onError, onNotifyError })

        await transitionWhileRequestIsPending(transition)
        const url = window.location.href
        pending.resolve(createResponse({ code: 'unauthorized', message: 'Late stream error' }, 401))

        await waitFor(() =>
          expect(onError).toHaveBeenCalledExactlyOnceWith('Late stream error', 'unauthorized'),
        )
        expect(window.location.href).toBe(url)
        expect(beginRecovery).not.toHaveBeenCalled()
        expect(onNotifyError).not.toHaveBeenCalled()
        expect(toast.error).not.toHaveBeenCalled()
      },
    )

    it.each([
      { transition: 'denied' as const, status: 401 },
      { transition: 'navigated' as const, status: 401 },
      { transition: 'denied' as const, status: 500 },
      { transition: 'navigated' as const, status: 500 },
    ])(
      'silently aborts late XHR $status errors after the page is $transition',
      async ({ transition, status }) => {
        const beginRecovery = vi.spyOn(webAppAuth, 'beginWebAppAuthorizationRecovery')
        const xhr = createXhr({ code: 'unauthorized', message: 'Late upload error' }, status)
        xhr.send = vi.fn()
        const response = upload({ xhr, data: new FormData() }, true).catch(
          (error: unknown) => error,
        )

        await transitionWhileRequestIsPending(transition)
        const url = window.location.href
        xhr.onreadystatechange?.(new Event('readystatechange'))

        expect(await response).toMatchObject({ name: 'AbortError' })
        expect(window.location.href).toBe(url)
        expect(beginRecovery).not.toHaveBeenCalled()
      },
    )
  })

  it.each([
    { status: 403, code: 'web_app_disabled', isPublicAPI: true },
    { status: 503, code: 'policy_unavailable', isPublicAPI: true },
    { status: 403, code: 'ip_access_denied', isPublicAPI: false },
  ])(
    'preserves ordinary errors for $status/$code with public API $isPublicAPI',
    async ({ status, code, isPublicAPI }) => {
      const data = { code, status, message: `Unchanged ${code}` }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(createResponse(data, status))

      const error = await request('/site', { method: 'POST' }, { isPublicAPI }).catch(
        (caught: unknown) => caught,
      )

      expect(error).toBeInstanceOf(Response)
      expect(isIpAccessDeniedError(error)).toBe(false)
      expect(ipAccessStore.get(ipAccessDeniedAtom)).toBeNull()
      await expect((error as Response).json()).resolves.toEqual(data)
      expect(toast.error).toHaveBeenCalledWith(data.message)
      expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
    },
  )

  it.each([
    { name: 'POST', stream: ssePost, path: '/chat-messages' },
    { name: 'GET', stream: sseGet, path: '/workflow/run-id/events' },
  ])(
    'settles a denied SSE $name before reading a stream without duplicate notifications',
    async ({ stream, path }) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(createResponse(denial))
      const onData = vi.fn()
      const onError = vi.fn()
      const onCompleted = vi.fn()
      const onNotifyError = vi.fn()
      const url = window.location.href

      await stream(path, {}, { isPublicAPI: true, onData, onError, onCompleted, onNotifyError })

      await waitFor(() => {
        expect(onError).toHaveBeenCalledExactlyOnceWith(denial.message, denial.code)
      })
      expect(onCompleted).not.toHaveBeenCalled()
      expect(onData).not.toHaveBeenCalled()
      expect(onNotifyError).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
      expect(fetch).toHaveBeenCalledOnce()
      expect(window.location.href).toBe(url)
    },
  )

  it('settles a denied stream through its completion callback when it has no error callback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(createResponse(denial))
    const onCompleted = vi.fn()

    await ssePost('/chat-messages', {}, { isPublicAPI: true, onCompleted })

    await waitFor(() => expect(onCompleted).toHaveBeenCalledExactlyOnceWith(true, denial.message))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    { route: '/chat/ip-restricted-app', path: '/files/upload' },
    { route: '/form/ip-restricted-form', path: '/human-input-forms/files' },
  ])(
    'marks denied XHR uploads on $route for the uploader to suppress duplicate errors',
    async ({ route, path }) => {
      window.history.replaceState({}, '', route)
      const xhr = createXhr(denial)

      await expect(upload({ xhr, data: new FormData() }, true, path)).rejects.toBe(xhr)

      expect(isIpAccessDeniedError(xhr)).toBe(true)
      expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('preserves unrelated XHR errors', async () => {
    const xhr = createXhr({ code: 'file_too_large', message: 'File too large' }, 413)

    await expect(upload({ xhr, data: new FormData() }, true)).rejects.toBe(xhr)

    expect(isIpAccessDeniedError(xhr)).toBe(false)
  })
})
