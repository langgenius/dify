import type {
  LoginStatusResponse,
  WebAppParametersResponse,
} from '@dify/contracts/api/web/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PUBLIC_API_PREFIX } from '@/config'
import {
  appAccessErrorAtom,
  appAccessStore,
  captureAppAccessScope,
  isAppAccessError,
} from '@/features/app-access-error/state'
import {
  expireWebAppAccountSession,
  getWebAppAuthSessionSnapshot,
  setWebAppAccessToken,
  setWebAppPassport,
} from '../webapp-auth'
import { webAppClient, webAppQuery } from './index'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('../refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

const anonymousStatus: LoginStatusResponse = { logged_in: false, app_logged_in: false }
const signedInStatus: LoginStatusResponse = { logged_in: true, app_logged_in: true }
const parameters: WebAppParametersResponse = {
  account_login_enabled: true,
  account_login_url: '/signin',
  allow_anonymous_end_user_auth: true,
  annotation_reply: {},
  connection_requirements: [],
  file_upload: {},
  more_like_this: {},
  requires_end_user_connections: false,
  retriever_resource: {},
  sensitive_word_avoidance: {},
  speech_to_text: {},
  suggested_questions: [],
  suggested_questions_after_answer: {},
  system_parameters: {
    audio_file_size_limit: 50,
    file_size_limit: 15,
    image_file_size_limit: 10,
    video_file_size_limit: 100,
    workflow_file_upload_limit: 10,
  },
  text_to_speech: {},
  user_input_form: [],
  connection_revision: 'published-workflow',
}

describe('generated Web App client', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
    window.history.replaceState({}, '', '/chat/shared-code')
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
  })

  it('prefers the signed-in Passport and falls back to the retained anonymous Passport after expiry', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(signedInStatus))
      .mockResolvedValueOnce(Response.json(anonymousStatus))
    const address = { kind: 'default', code: 'shared-code' } as const
    setWebAppPassport(address, 'anonymous-passport', 'anonymous')
    setWebAppAccessToken('web-account-token')
    setWebAppPassport(address, 'app-passport')
    await expect(
      webAppClient.login.status.get({ query: { app_code: address.code, mode: 'end_user' } }),
    ).resolves.toEqual(signedInStatus)

    const [input, options] = fetch.mock.calls[0]!
    const url = new URL(input instanceof Request ? input.url : String(input))
    const expectedURL = new URL(`${PUBLIC_API_PREFIX}/login/status`, window.location.origin)
    expect(`${url.origin}${url.pathname}`).toBe(expectedURL.href)
    expect(url.searchParams.get('mode')).toBe('end_user')
    expect(url.searchParams.get('app_code')).toBe(address.code)
    const headers = new Headers(options?.headers)
    expect(headers.get('Authorization')).toBe('Bearer web-account-token')
    expect(headers.get('X-App-Code')).toBe(address.code)
    expect(headers.get('X-App-Passport')).toBe('app-passport')
    expect(input instanceof Request ? input.credentials : options?.credentials).toBe('include')

    expireWebAppAccountSession()
    await expect(
      webAppClient.login.status.get({ query: { app_code: address.code, mode: 'end_user' } }),
    ).resolves.toEqual(anonymousStatus)
    const anonymousHeaders = new Headers(fetch.mock.calls[1]![1]?.headers)
    expect(anonymousHeaders.get('X-App-Passport')).toBe('anonymous-passport')
    expect(anonymousHeaders.has('Authorization')).toBe(false)
  })

  it('sends the PKCE login exchange body through the generated public transport', async () => {
    let sentBody: unknown
    let sentMethod: string | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      sentMethod = request.method
      sentBody = await request.json()
      return Response.json({ access_token: 'app-passport' })
    })
    const body = { login_code: 'one-use-code', code_verifier: 'a'.repeat(43) }

    await expect(
      webAppClient.passport.post({ headers: { 'X-App-Code': 'shared-code' }, body }),
    ).resolves.toEqual({ access_token: 'app-passport' })

    expect(sentMethod).toBe('POST')
    expect(sentBody).toEqual(body)
  })

  it('uses the environment API prefix and passport for generated parameters', async () => {
    window.history.replaceState({}, '', '/environment/chat/shared-code')
    setWebAppPassport({ kind: 'default', code: 'shared-code' }, 'default-passport')
    const address = { kind: 'environment', code: 'shared-code' } as const
    setWebAppPassport(address, 'environment-passport')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(parameters))
    await expect(
      queryClient.query(
        webAppQuery.parameters.get.queryOptions({
          context: { address },
          queryKey: [...webAppQuery.parameters.get.queryKey(), address],
        }),
      ),
    ).resolves.toEqual(parameters)

    const [input, options] = fetch.mock.calls[0]!
    expect(input instanceof Request ? input.url : String(input)).toBe(
      new URL(`${PUBLIC_API_PREFIX}/environment/shared-code/parameters`, window.location.origin)
        .href,
    )
    expect(new Headers(options?.headers).get('X-App-Passport')).toBe('environment-passport')
  })

  it('isolates cached responses by App address and identity session', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const scopes = [
      {
        path: '/chat/shared-code',
        address: { kind: 'default', code: 'shared-code' } as const,
        identity: '',
        response: anonymousStatus,
      },
      {
        path: '/chat/another-code',
        address: { kind: 'default', code: 'another-code' } as const,
        identity: '',
        response: signedInStatus,
      },
      {
        path: '/environment/chat/shared-code',
        address: { kind: 'environment', code: 'shared-code' } as const,
        identity: '',
        response: signedInStatus,
      },
      {
        path: '/chat/shared-code',
        address: { kind: 'default', code: 'shared-code' } as const,
        identity: 'signed-in',
        response: signedInStatus,
      },
    ]

    const input = { query: { mode: 'end_user' as const } }
    for (const scope of scopes) {
      window.history.replaceState({}, '', scope.path)
      fetch.mockResolvedValueOnce(Response.json(scope.response))
      const options = webAppQuery.login.status.get.queryOptions({
        input,
        context: { address: scope.address },
        queryKey: [
          ...webAppQuery.login.status.get.queryKey({ input }),
          scope.address,
          scope.identity,
        ],
        staleTime: Infinity,
      })
      await expect(queryClient.query(options)).resolves.toEqual(scope.response)
    }

    expect(fetch).toHaveBeenCalledTimes(scopes.length)
    window.history.replaceState({}, '', '/chat/shared-code')
    const address = { kind: 'default', code: 'shared-code' } as const
    await expect(
      queryClient.query(
        webAppQuery.login.status.get.queryOptions({
          input,
          context: { address },
          queryKey: [...webAppQuery.login.status.get.queryKey({ input }), address, ''],
          staleTime: Infinity,
        }),
      ),
    ).resolves.toEqual(anonymousStatus)
    expect(fetch).toHaveBeenCalledTimes(scopes.length)
  })

  it('rejects a request bound to a previous App before sending after navigation', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const address = { kind: 'default', code: 'shared-code' } as const
    window.history.replaceState({}, '', '/chat/another-code')

    await expect(
      webAppClient.parameters.get(undefined, { context: { address } }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects query options created for App A when executed after switching to App B', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const address = { kind: 'default', code: 'shared-code' } as const
    const options = webAppQuery.parameters.get.queryOptions({
      context: { address },
      queryKey: [...webAppQuery.parameters.get.queryKey(), address],
    })
    window.history.replaceState({}, '', '/chat/another-code')

    await expect(queryClient.query(options)).rejects.toMatchObject({ name: 'AbortError' })

    expect(fetch).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined()
  })

  it('uses the current default or environment App for each direct singleton call without leaking scope', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const scopes = [
      {
        path: '/chat/shared-code',
        address: { kind: 'default', code: 'shared-code' } as const,
        passport: 'default-passport',
        apiPath: '/parameters',
      },
      {
        path: '/environment/chat/shared-code',
        address: { kind: 'environment', code: 'shared-code' } as const,
        passport: 'environment-passport',
        apiPath: '/environment/shared-code/parameters',
      },
      {
        path: '/chat/another-code',
        address: { kind: 'default', code: 'another-code' } as const,
        passport: 'another-app-passport',
        apiPath: '/parameters',
      },
      {
        path: '/chat/shared-code',
        address: { kind: 'default', code: 'shared-code' } as const,
        passport: 'default-passport',
        apiPath: '/parameters',
      },
    ]
    for (const scope of scopes) setWebAppPassport(scope.address, scope.passport)

    for (const [index, scope] of scopes.entries()) {
      window.history.replaceState({}, '', scope.path)
      const response = { ...parameters, connection_revision: `workflow-${index}` }
      fetch.mockResolvedValueOnce(Response.json(response))

      await expect(webAppClient.parameters.get()).resolves.toEqual(response)

      const [input, options] = fetch.mock.calls[index]!
      expect(input instanceof Request ? input.url : String(input)).toBe(
        new URL(`${PUBLIC_API_PREFIX}${scope.apiPath}`, window.location.origin).href,
      )
      const headers = new Headers(options?.headers)
      expect(headers.get('X-App-Code')).toBe(scope.address.code)
      expect(headers.get('X-App-Passport')).toBe(scope.passport)
    }

    expect(fetch).toHaveBeenCalledTimes(scopes.length)
  })

  it('discards an in-flight response after navigating to another App', async () => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => {
      resolve = done
    })
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending)
    const result = webAppClient.parameters.get().catch((error: unknown) => error)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    window.history.replaceState({}, '', '/chat/another-code')
    resolve(Response.json(parameters))

    expect(await result).toMatchObject({ name: 'AbortError' })
  })

  it('preserves the public access guard for an IP denial', async () => {
    const denial = {
      code: 'ip_access_denied',
      message: 'Access denied',
      status: 403,
      client_ip: '203.0.113.42',
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(denial, { status: 403 }))
    const error = await webAppClient.parameters.get().catch((caught: unknown) => caught)

    expect(isAppAccessError(error)).toBe(true)
    expect(appAccessStore.get(appAccessErrorAtom)?.clientIp).toBe(denial.client_ip)
  })

  it('rejects a query prepared under the previous account even within the same App', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    setWebAppAccessToken('account-a', 'end_user')
    const address = { kind: 'default', code: 'shared-code' } as const
    const authSession = getWebAppAuthSessionSnapshot()
    const options = webAppQuery.parameters.get.queryOptions({
      context: { address, authSession },
      queryKey: [...webAppQuery.parameters.get.queryKey(), address, authSession],
    })
    setWebAppAccessToken('account-b', 'end_user')

    await expect(queryClient.query(options)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('discards an old-account denial before it can change access state for the new account', async () => {
    setWebAppAccessToken('account-a', 'end_user')
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => {
      resolve = done
    })
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending)
    const result = webAppClient.parameters.get().catch((error: unknown) => error)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    setWebAppAccessToken('account-b', 'end_user')
    resolve(
      Response.json(
        { code: 'ip_access_denied', message: 'Old-account denial', client_ip: '203.0.113.42' },
        { status: 403 },
      ),
    )

    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
  })
})
