import { waitFor } from '@testing-library/react'
import { PUBLIC_API_PREFIX } from '@/config'
import { createDeferred } from '@/test/deferred'
import {
  getAnonymousWebAppPassport,
  getAuthenticatedWebAppPassport,
  getWebAppAccessToken,
  getWebAppLoginMode,
  getWebAppPassport,
  setWebAppPassport,
  startWebAppAccountSession,
} from '../webapp-auth'
import { restoreWebAppAccountSession } from './account-session'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const address = { kind: 'default', code: 'research' } as const

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/chat/research')
  startWebAppAccountSession()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('App user session restoration', () => {
  it('renews only the App Passport using the HttpOnly cookie and end_user mode', async () => {
    setWebAppPassport(address, 'anonymous-passport', 'anonymous')
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ logged_in: true, app_logged_in: false }))
      .mockResolvedValueOnce(Response.json({ access_token: 'renewed-passport' }))

    await expect(restoreWebAppAccountSession(address, () => true)).resolves.toBe(true)

    const [statusInput, statusInit] = fetch.mock.calls[0]!
    const statusRequest = new Request(statusInput, statusInit)
    const statusUrl = new URL(statusRequest.url)
    expect(statusUrl.pathname).toBe(
      new URL(`${PUBLIC_API_PREFIX}/login/status`, window.location.origin).pathname,
    )
    expect(statusUrl.searchParams.get('mode')).toBe('end_user')
    expect(statusUrl.searchParams.get('app_code')).toBe('research')
    expect(statusRequest.headers.has('Authorization')).toBe(false)
    expect(statusRequest.credentials).toBe('include')
    const [passportInput, passportInit] = fetch.mock.calls[1]!
    const passportRequest = new Request(passportInput, passportInit)
    expect(new URL(passportRequest.url).searchParams.get('mode')).toBe('end_user')
    expect(passportRequest.headers.get('X-App-Code')).toBe('research')
    expect(passportRequest.headers.has('Authorization')).toBe(false)
    expect(passportRequest.credentials).toBe('include')
    expect(getWebAppLoginMode()).toBe('end_user')
    expect(getWebAppPassport(address)).toBe('renewed-passport')
    expect(getAuthenticatedWebAppPassport(address)).toBe('renewed-passport')
    expect(getAnonymousWebAppPassport(address)).toBe('anonymous-passport')
  })

  it('keeps an already valid App Passport without renewing it', async () => {
    setWebAppPassport(address, 'existing-passport')
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ logged_in: true, app_logged_in: true }))

    await expect(restoreWebAppAccountSession(address, () => true)).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledOnce()
    expect(getWebAppPassport(address)).toBe('existing-passport')
  })

  it('clears an expired account session and preserves anonymous conversation history', async () => {
    setWebAppPassport(address, 'anonymous-passport', 'anonymous')
    setWebAppPassport(address, 'expired-passport')
    localStorage.setItem('session_id-research', 'anonymous-history')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ logged_in: false, app_logged_in: false }),
    )

    await expect(restoreWebAppAccountSession(address, () => true)).resolves.toBe(false)

    expect(getWebAppAccessToken()).toBe('')
    expect(getWebAppLoginMode()).toBe('console')
    expect(getAuthenticatedWebAppPassport(address)).toBe('')
    expect(getWebAppPassport(address)).toBe('anonymous-passport')
    expect(localStorage.getItem('session_id-research')).toBe('anonymous-history')
  })

  it.each(['status', 'passport'])(
    'clears an unauthorized account during %s lookup',
    async (stage) => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      if (stage === 'passport')
        fetch.mockResolvedValueOnce(Response.json({ logged_in: true, app_logged_in: false }))
      fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))

      await expect(restoreWebAppAccountSession(address, () => true)).resolves.toBe(false)
      expect(getWebAppAccessToken()).toBe('')
      expect(getWebAppLoginMode()).toBe('console')
    },
  )

  it('retains the account session marker when restoration fails because the service is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }))

    await expect(restoreWebAppAccountSession(address, () => true)).rejects.toThrow()
    expect(getWebAppLoginMode()).toBe('end_user')
  })

  it.each([403, 503])(
    'preserves account and anonymous credentials when Passport renewal fails with %s',
    async (status) => {
      setWebAppPassport(address, 'anonymous-passport', 'anonymous')
      setWebAppPassport(address, 'existing-account-passport', 'authenticated')
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(Response.json({ logged_in: true, app_logged_in: false }))
        .mockResolvedValueOnce(new Response(null, { status }))

      await expect(restoreWebAppAccountSession(address, () => true)).rejects.toThrow()

      expect(getWebAppLoginMode()).toBe('end_user')
      expect(getAuthenticatedWebAppPassport(address)).toBe('existing-account-passport')
      expect(getAnonymousWebAppPassport(address)).toBe('anonymous-passport')
    },
  )

  it.each([200, 401])(
    'ignores the previous account Passport response with status %s after switching accounts',
    async (status) => {
      setWebAppPassport(address, 'anonymous-passport', 'anonymous')
      const passport = createDeferred<Response>()
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(Response.json({ logged_in: true, app_logged_in: false }))
        .mockReturnValueOnce(passport.promise)

      const restoring = restoreWebAppAccountSession(address, () => true)
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      startWebAppAccountSession()
      setWebAppPassport(address, 'next-account-passport', 'authenticated')
      passport.resolve(
        status === 200
          ? Response.json({ access_token: 'previous-account-passport' })
          : new Response(null, { status }),
      )

      await expect(restoring).resolves.toBe(false)
      expect(getWebAppLoginMode()).toBe('end_user')
      expect(getAuthenticatedWebAppPassport(address)).toBe('next-account-passport')
      expect(getAnonymousWebAppPassport(address)).toBe('anonymous-passport')
    },
  )

  it('discards an old account response after the user switches accounts', async () => {
    let resolveStatus!: (response: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveStatus = resolve
      }),
    )
    const restoring = restoreWebAppAccountSession(address, () => true)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    startWebAppAccountSession()
    resolveStatus(Response.json({ logged_in: false, app_logged_in: false }))

    await expect(restoring).resolves.toBe(false)
    expect(getWebAppLoginMode()).toBe('end_user')
  })
})
