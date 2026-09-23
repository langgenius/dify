import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import {
  appAccessErrorAtom,
  appAccessStore,
  beginTrialAppAccess,
  captureAppAccessScope,
  endTrialAppAccess,
  isAppAccessError,
  trialAppAccessErrorAtom,
} from '@/features/app-access-error/state'
import { markAppDeletionFailed, markAppDeletionStarted } from '../app-deletion'
// oxlint-disable-next-line no-restricted-imports -- This integration spec exercises public WebApp transport error handling.
import { request, sseGet, ssePost, upload } from '../base'
import { consoleClient } from '../console'
import * as webAppAuth from '../webapp-auth'

const refreshAccessTokenOrReLogin = vi.hoisted(() => vi.fn())

vi.mock('@/app/notifications', () => ({
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
    expect(isAppAccessError(error)).toBe(true)
  } else {
    window.history.replaceState({}, '', '/environment/chat/another-app')
    captureAppAccessScope()
  }
}

describe('WebApp IP access denial transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
    window.history.replaceState({}, '', '/chat/ip-restricted-app')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
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
      expect(isAppAccessError(error)).toBe(true)
      expect(appAccessStore.get(appAccessErrorAtom)?.clientIp).toBe(denial.client_ip)
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

    expect(isAppAccessError(error)).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
    expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('does not publish a late rejection for the previous App', async () => {
    const pending = createPendingResponse()
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise)
    const response = request('/site', {}, { isPublicAPI: true }).catch((error: unknown) => error)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce())

    window.history.replaceState({}, '', '/chat/another-app')
    captureAppAccessScope()
    pending.resolve(createResponse(denial))

    expect(isAppAccessError(await response)).toBe(true)
    expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
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
        const currentDenial = appAccessStore.get(appAccessErrorAtom)
        pending.resolve(
          code
            ? createResponse({ code, message: 'Late authorization error' }, status)
            : new Response('not JSON', { status }),
        )

        expect(await response).toBeInstanceOf(Response)
        expect(window.location.href).toBe(url)
        expect(appAccessStore.get(appAccessErrorAtom)).toBe(currentDenial)
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
      expect(isAppAccessError(error)).toBe(false)
      expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
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

      expect(isAppAccessError(xhr)).toBe(true)
      expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('preserves unrelated XHR errors', async () => {
    const xhr = createXhr({ code: 'file_too_large', message: 'File too large' }, 413)

    await expect(upload({ xhr, data: new FormData() }, true)).rejects.toBe(xhr)

    expect(isAppAccessError(xhr)).toBe(false)
  })
})

describe('application not-found transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
  })
  afterEach(() => vi.restoreAllMocks())

  it('handles the opaque Gateway 404 on a non-identity runtime request without an auth retry', async () => {
    window.history.replaceState({}, '', '/chat/app')
    const body = {
      code: 'app_not_found',
      message: 'App not found.',
      status: 404,
      client_ip: '203.0.113.8',
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse(body, 404))
    const error = await request(
      '/chat-messages',
      { method: 'POST', body: {} },
      { isPublicAPI: true },
    ).catch((error) => error)
    expect(isAppAccessError(error)).toBe(true)
    expect(await (error as Response).json()).toEqual(body)
    expect(appAccessStore.get(appAccessErrorAtom)).toMatchObject({
      reason: 'app_not_found',
      clientIp: '203.0.113.8',
    })
    expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe('/chat/app')
  })

  it('handles an opaque Gateway upload 404 through the same App error boundary', async () => {
    window.history.replaceState({}, '', '/chat/app')
    const body = {
      code: 'app_not_found',
      message: 'App not found.',
      status: 404,
      client_ip: '2001:db8::12',
    }
    const xhr = createXhr(body, 404)
    await expect(upload({ xhr, data: new FormData() }, true, '/files/upload')).rejects.toBe(xhr)
    expect(isAppAccessError(xhr)).toBe(true)
    expect(appAccessStore.get(appAccessErrorAtom)?.clientIp).toBe('2001:db8::12')
    expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'POST', stream: ssePost, path: '/chat-messages' },
    { name: 'GET', stream: sseGet, path: '/workflow/run-id/events' },
  ])(
    'settles an opaque Gateway 404 before opening an SSE $name stream',
    async ({ stream, path }) => {
      window.history.replaceState({}, '', '/chat/app')
      const body = {
        code: 'app_not_found',
        message: 'App not found.',
        status: 404,
        client_ip: '203.0.113.8',
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(createResponse(body, 404))
      const onData = vi.fn()
      const onError = vi.fn()
      const onCompleted = vi.fn()
      await stream(path, {}, { isPublicAPI: true, onData, onError, onCompleted })
      await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(body.message, body.code))
      expect(onData).not.toHaveBeenCalled()
      expect(onCompleted).not.toHaveBeenCalled()
      expect(appAccessStore.get(appAccessErrorAtom)?.clientIp).toBe('203.0.113.8')
      expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['/form/human_input/token', 404, 'not_found', 'Form not found'],
    [
      '/human-input-forms/files',
      403,
      'invalid_upload_token',
      'Upload token is invalid or expired.',
    ],
  ])(
    'leaves the native HITL unavailable response to its form owner: %s',
    async (path, status, code, message) => {
      window.history.replaceState({}, '', '/form/token')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        createResponse({ code, message, status }, status),
      )
      const error = await request(path, {}, { isPublicAPI: true }).catch((error) => error)
      expect(isAppAccessError(error)).toBe(false)
      expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
    },
  )

  it.each([
    ['/chat/app', '/site', true],
    ['/completion/app', '/parameters', true],
    ['/workflow/app', '/passport', true],
    ['/environment/agent/app', '/login/status', true],
    ['/agent/app', '/webapp/access-mode?appCode=app', true],
    ['/app/app/workflow', '/apps/app', false],
    ['/agents/app/access', '/agent/app', false],
    ['/installed/app', '/installed-apps/app', false],
  ])(
    'handles an identity 404 at %s without consuming the error or retrying',
    async (route, url, isPublicAPI) => {
      window.history.replaceState({}, '', route)
      const body = { code: 'not_found', message: 'App not found', client_ip: '203.0.113.8' }
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse(body, 404))
      const error = await request(url, {}, { isPublicAPI }).catch((error) => error)
      expect(isAppAccessError(error)).toBe(true)
      expect(error).toBeInstanceOf(Response)
      expect(await (error as Response).json()).toEqual(body)
      expect(appAccessStore.get(appAccessErrorAtom)).toMatchObject({
        reason: 'app_not_found',
        clientIp: '203.0.113.8',
      })
      expect(toast.error).not.toHaveBeenCalled()
      await request(url, {}, { isPublicAPI }).catch(() => undefined)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    ['/chat/app', '/conversations/gone', true, 404, 'not_found'],
    ['/app/app/workflow', '/apps/app/workflows/draft', false, 404, 'not_found'],
    ['/app/app/workflow', '/apps/other', false, 404, 'app_not_found'],
    ['/form/token', '/form/human_input/token', true, 404, 'not_found'],
    ['/chat/app', '/site', true, 503, 'policy_unavailable'],
    ['/agents/app/access', '/agent/app', false, 403, 'forbidden'],
  ])('preserves unrelated errors at %s for %s', async (route, url, isPublicAPI, status, code) => {
    window.history.replaceState({}, '', route)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createResponse({ code, message: 'Existing error' }, status),
    )
    const error = await request(url, {}, { isPublicAPI }).catch((error) => error)
    expect(isAppAccessError(error)).toBe(false)
    expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
  })
})

it.each([
  ['/app/deleting/workflow', '/apps/deleting', 'deleting'],
  ['/agents/deleting/access', '/agent/deleting', 'agent:deleting'],
  ['/installed/deleting', '/installed-apps/deleting', 'installed:deleting'],
])('does not replace %s during intentional deletion', async (route, url, key) => {
  window.history.replaceState({}, '', '/')
  captureAppAccessScope()
  window.history.replaceState({}, '', route)
  markAppDeletionStarted(key)
  try {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse({ code: 'app_not_found' }, 404))
    const error = await request(url).catch((error) => error)
    expect(isAppAccessError(error)).toBe(false)
    expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
  } finally {
    markAppDeletionFailed(key)
    vi.restoreAllMocks()
  }
})

it('ignores a console authorization failure arriving after the application 404', async () => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/')
  captureAppAccessScope()
  window.history.replaceState({}, '', '/app/missing/workflow')
  const late = createPendingResponse()
  const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(late.promise)
  const pending = request('/apps/missing/workflows/draft').catch((error) => error)
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  fetch.mockResolvedValueOnce(createResponse({ code: 'app_not_found' }, 404))
  await request('/apps/missing').catch(() => undefined)
  late.resolve(createResponse({ code: 'unauthorized', message: 'Unauthorized' }, 401))
  await pending
  expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  expect(window.location.pathname).toBe('/app/missing/workflow')
  vi.restoreAllMocks()
})

it.each(['agent', 'installed'] as const)(
  'connects the generated %s detail client to the page boundary',
  async (kind) => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
    window.history.replaceState(
      {},
      '',
      kind === 'agent' ? '/agents/missing/access' : '/installed/missing',
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse({ code: 'not_found' }, 404))
    try {
      const promise =
        kind === 'agent'
          ? consoleClient.agent.byAgentId.get({ params: { agent_id: 'missing' } })
          : consoleClient.installedApps.byInstalledAppId.get({
              params: { installed_app_id: 'missing' },
            })
      await promise.catch(() => undefined)
      expect(appAccessStore.get(appAccessErrorAtom)).toMatchObject({ reason: 'app_not_found' })
      expect(toast.error).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  },
)

describe('trial application error isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/explore/apps')
    captureAppAccessScope()
  })
  afterEach(() => vi.restoreAllMocks())

  it.each(['/trial-apps/missing', '/trial-apps/missing/parameters'])(
    'handles a trial identity 404 at %s without replacing the explore page',
    async (path) => {
      const scope = beginTrialAppAccess('missing')
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(createResponse({ message: 'Not found' }, 404))
      try {
        const error = await request(path).catch((error: unknown) => error)
        expect(isAppAccessError(error)).toBe(true)
        expect(appAccessStore.get(trialAppAccessErrorAtom)?.scope).toBe(scope)
        expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
        await expect(request(path)).rejects.toMatchObject({ name: 'AbortError' })
        expect(fetch).toHaveBeenCalledOnce()
        expect(toast.error).not.toHaveBeenCalled()
      } finally {
        endTrialAppAccess(scope)
      }
    },
  )

  it('ignores a late response after closing and reopening the same trial', async () => {
    const first = beginTrialAppAccess('missing')
    const pending = createPendingResponse()
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise)
    const result = request('/trial-apps/missing').catch((error: unknown) => error)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce())
    endTrialAppAccess(first)
    const next = beginTrialAppAccess('missing')
    try {
      pending.resolve(createResponse({ code: 'app_not_found' }, 404))
      expect(isAppAccessError(await result)).toBe(true)
      expect(appAccessStore.get(trialAppAccessErrorAtom)).toBeNull()
      expect(toast.error).not.toHaveBeenCalled()
    } finally {
      endTrialAppAccess(next)
    }
  })

  it.each([true, false])(
    'handles explicit app_not_found before SSE starts (public=%s)',
    async (isPublicAPI) => {
      const scope = isPublicAPI ? null : beginTrialAppAccess('missing')
      if (isPublicAPI) window.history.replaceState({}, '', '/chat/missing')
      const error = { code: 'app_not_found', message: 'App not found' }
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createResponse(error, 404))
      const onError = vi.fn()
      const onNotifyError = vi.fn()
      const path = isPublicAPI ? '/chat-messages' : '/trial-apps/missing/chat-messages'
      try {
        await ssePost(path, {}, { isPublicAPI, onError, onNotifyError })
        await waitFor(() =>
          expect(onError).toHaveBeenCalledExactlyOnceWith(error.message, error.code),
        )
        expect(
          appAccessStore.get(isPublicAPI ? appAccessErrorAtom : trialAppAccessErrorAtom)?.reason,
        ).toBe('app_not_found')
        expect(onNotifyError).not.toHaveBeenCalled()
        expect(toast.error).not.toHaveBeenCalled()
        await ssePost(path, {}, { isPublicAPI })
        expect(fetch).toHaveBeenCalledOnce()
      } finally {
        if (scope) endTrialAppAccess(scope)
      }
    },
  )
})
