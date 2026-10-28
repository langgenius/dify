import { waitFor } from '@testing-library/react'
import { PUBLIC_API_PREFIX } from '@/config'
import {
  getAnonymousWebAppPassport,
  getAuthenticatedWebAppPassport,
  getWebAppAccessToken,
  getWebAppPassport,
  setWebAppAccessToken,
  setWebAppPassport,
} from '../webapp-auth'
import { restoreWebAppAccountSession } from './account-session'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const address = { kind: 'default', code: 'research' } as const

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/chat/research')
  setWebAppAccessToken('account-proof', 'end_user')
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('App user session restoration', () => {
  it('renews only the App Passport using the existing account proof and end_user mode', async () => {
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
    expect(statusRequest.headers.get('Authorization')).toBe('Bearer account-proof')
    const [passportInput, passportInit] = fetch.mock.calls[1]!
    const passportRequest = new Request(passportInput, passportInit)
    expect(new URL(passportRequest.url).searchParams.get('mode')).toBe('end_user')
    expect(passportRequest.headers.get('X-App-Code')).toBe('research')
    expect(getWebAppAccessToken()).toBe('account-proof')
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
    },
  )

  it('retains the account proof when restoration fails because the service is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }))

    await expect(restoreWebAppAccountSession(address, () => true)).rejects.toThrow()
    expect(getWebAppAccessToken()).toBe('account-proof')
  })

  it('discards an old account response after the user switches accounts', async () => {
    let resolveStatus!: (response: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveStatus = resolve
      }),
    )
    const restoring = restoreWebAppAccountSession(address, () => true)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    setWebAppAccessToken('next-account-proof', 'end_user')
    resolveStatus(Response.json({ logged_in: false, app_logged_in: false }))

    await expect(restoring).resolves.toBe(false)
    expect(getWebAppAccessToken()).toBe('next-account-proof')
  })
})
