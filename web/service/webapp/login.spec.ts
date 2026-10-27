import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { captureAppAccessScope } from '@/features/app-access-error/state'
import { parseWebAppAddress, resolveWebAppAddress } from '../webapp-address'
import { getWebAppAccessToken, getWebAppPassport, setWebAppAccessToken } from '../webapp-auth'
import {
  beginWebAppAccountLogin,
  cancelWebAppAccountLogin,
  completeWebAppAccountLogin,
  isWebAppAccountCallback,
} from './login'

vi.mock('@/utils/var', async (original) => ({
  ...(await original<typeof import('@/utils/var')>()),
  basePath: '/base',
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

const accountUrl = 'https://accounts.example/console/signin?source=webapp'
let sequence = 0
let returnUrl: string

function callback(code = 'one-use-code') {
  window.history.replaceState(
    {},
    '',
    `/base/webapp-signin?${new URLSearchParams({ mode: 'end_user', login_code: code, redirect_url: returnUrl })}`,
  )
}

describe('Webapp Account PKCE transaction', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal('crypto', webcrypto)
    window.history.replaceState(
      {},
      '',
      `/base/chat/app-${++sequence}?query=hello%20world&literal=a%2Bb#conversation`,
    )
    captureAppAccessScope()
    returnUrl = window.location.href
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
  })

  it('keeps the verifier on the Web origin and preserves the API signin prefix and complete App URL', async () => {
    const login = new URL(await beginWebAppAccountLogin(accountUrl, returnUrl))
    expect(login.origin).toBe('https://accounts.example')
    expect(login.pathname).toBe('/console/signin')
    expect(login.searchParams.get('source')).toBe('webapp')
    expect(login.searchParams.get('app_code')).toBe(`app-${sequence}`)
    expect(login.searchParams.get('redirect_url')).toBe(returnUrl)
    expect(login.searchParams.get('code_challenge_method')).toBe('S256')
    expect(login.searchParams.get('code_verifier')).toBeNull()
    const stored = JSON.parse(sessionStorage.getItem(`webapp-account-login-app-${sequence}`)!)
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stored.verifier)),
    )
    const challenge = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(login.searchParams.get('code_challenge')).toBe(challenge)
    expect(login.href).not.toContain(stored.verifier)
  })

  it('exchanges exactly once across concurrent calls and a completed callback remount, then stores both tokens', async () => {
    await beginWebAppAccountLogin(accountUrl, returnUrl)
    callback()
    let body: unknown
    let headers: Headers | undefined
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      headers = request.headers
      body = await request.json()
      expect(new URL(request.url).pathname).toMatch(/\/passport$/)
      return Response.json({ access_token: 'app-passport', webapp_access_token: 'web-proof' })
    })
    const first = completeWebAppAccountLogin(returnUrl, 'one-use-code')
    const concurrent = completeWebAppAccountLogin(returnUrl, 'one-use-code')
    expect(first).toBe(concurrent)
    await expect(first).resolves.toBe(returnUrl)
    await expect(completeWebAppAccountLogin(returnUrl, 'one-use-code')).resolves.toBe(returnUrl)
    expect(fetch).toHaveBeenCalledOnce()
    expect(headers?.get('X-App-Code')).toBe(`app-${sequence}`)
    expect(body).toEqual({
      login_code: 'one-use-code',
      code_verifier: expect.stringMatching(/^[\w-]{43}$/),
    })
    expect(getWebAppAccessToken()).toBe('web-proof')
    expect(getWebAppPassport({ kind: 'default', code: `app-${sequence}` })).toBe('app-passport')
    expect(sessionStorage.getItem(`webapp-account-login-app-${sequence}`)).toBeNull()
  })

  it.each(['cancel', 'expired', 'wrong-return'] as const)(
    'rejects a %s transaction before any exchange',
    async (scenario) => {
      await beginWebAppAccountLogin(accountUrl, returnUrl)
      callback()
      const fetch = vi.spyOn(globalThis, 'fetch')
      if (scenario === 'cancel') cancelWebAppAccountLogin(returnUrl)
      if (scenario === 'expired') {
        const key = `webapp-account-login-app-${sequence}`
        const value = JSON.parse(sessionStorage.getItem(key)!)
        sessionStorage.setItem(
          key,
          JSON.stringify({ ...value, createdAt: Date.now() - 31 * 60 * 1000 }),
        )
      }
      const target = scenario === 'wrong-return' ? `${returnUrl}-changed` : returnUrl
      await expect(completeWebAppAccountLogin(target, 'one-use-code')).rejects.toThrow(
        'Missing or expired',
      )
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('does not save an old exchange after the Web account changes', async () => {
    await beginWebAppAccountLogin(accountUrl, returnUrl)
    callback()
    let finish!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const operation = completeWebAppAccountLogin(returnUrl, 'one-use-code')
    setWebAppAccessToken('newer-account', 'end_user')
    finish(Response.json({ access_token: 'old-passport', webapp_access_token: 'old-proof' }))
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(getWebAppAccessToken()).toBe('newer-account')
    expect(getWebAppPassport({ kind: 'default', code: `app-${sequence}` })).toBe('')
  })

  it.each(['navigation', 'cancel', 'new transaction'] as const)(
    'does not complete an exchange after %s changes its scope',
    async (change) => {
      await beginWebAppAccountLogin(accountUrl, returnUrl)
      callback()
      let finish!: (response: Response) => void
      const response = new Promise<Response>((resolve) => {
        finish = resolve
      })
      vi.spyOn(globalThis, 'fetch').mockReturnValue(response)
      const operation = completeWebAppAccountLogin(returnUrl, 'old-one-use-code')
      if (change === 'navigation') window.history.replaceState({}, '', '/base/chat/another-app')
      else if (change === 'cancel') cancelWebAppAccountLogin(returnUrl)
      else await beginWebAppAccountLogin(accountUrl, returnUrl)

      finish(Response.json({ access_token: 'old-passport', webapp_access_token: 'old-proof' }))

      await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      expect(getWebAppAccessToken()).toBe('')
      expect(getWebAppPassport({ kind: 'default', code: `app-${sequence}` })).toBe('')
      if (change === 'new transaction')
        expect(sessionStorage.getItem(`webapp-account-login-app-${sequence}`)).not.toBeNull()
    },
  )

  it('retains neither a failed exchange transaction nor tokens', async () => {
    await beginWebAppAccountLogin(accountUrl, returnUrl)
    callback()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { code: 'invalid_param', message: 'Expired code', status: 400 },
        { status: 400 },
      ),
    )
    await expect(completeWebAppAccountLogin(returnUrl, 'expired-code')).rejects.toThrow()
    expect(getWebAppAccessToken()).toBe('')
    expect(sessionStorage.getItem(`webapp-account-login-app-${sequence}`)).toBeNull()
  })

  it('does not reuse a completed callback after the account changes', async () => {
    await beginWebAppAccountLogin(accountUrl, returnUrl)
    callback()
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ access_token: 'passport', webapp_access_token: 'proof' }))
    await completeWebAppAccountLogin(returnUrl, 'one-use-code')
    setWebAppAccessToken('another-account', 'end_user')

    await expect(completeWebAppAccountLogin(returnUrl, 'one-use-code')).rejects.toThrow(
      'Missing or expired',
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(getWebAppAccessToken()).toBe('another-account')
  })

  it('rejects foreign, environment and non-HTTP App returns', async () => {
    for (const target of [
      'https://untrusted.example/chat/code',
      '/base/environment/chat/code',
      'javascript:alert(1)',
    ])
      await expect(beginWebAppAccountLogin(accountUrl, target)).rejects.toThrow('Invalid Web App')
  })

  it('fails before navigation when the PKCE verifier cannot be stored', async () => {
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable.', 'SecurityError')
    })
    const fetch = vi.spyOn(globalThis, 'fetch')

    await expect(beginWebAppAccountLogin(accountUrl, returnUrl)).rejects.toMatchObject({
      name: 'SecurityError',
    })

    expect(window.location.href).toBe(returnUrl)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('recognizes only the dedicated ordinary App callback, including a deployment prefix, without browser globals', () => {
    const params = new URLSearchParams({
      mode: 'end_user',
      redirect_url: 'https://apps.example/base/chat/code?x=1#history',
    })
    vi.stubGlobal('window', undefined)
    expect(isWebAppAccountCallback('/base/webapp-signin', params)).toBe(true)
    expect(isWebAppAccountCallback('/chat/code', params)).toBe(false)
    params.set('redirect_url', 'https://apps.example/base/environment/chat/code')
    expect(isWebAppAccountCallback('/base/webapp-signin', params)).toBe(false)
  })

  it('parses prefixed default/environment routes and resolves callback targets without corrupting their encoding', () => {
    expect(parseWebAppAddress('/base/chat/code')).toEqual({ kind: 'default', code: 'code' })
    expect(parseWebAppAddress('/base/environment/workflow/code')).toEqual({
      kind: 'environment',
      code: 'code',
    })
    expect(parseWebAppAddress('/base-other/chat/code')).toBeNull()
    callback()
    expect(resolveWebAppAddress()).toEqual({ kind: 'default', code: `app-${sequence}` })
    expect(new URL(returnUrl).searchParams.get('literal')).toBe('a+b')
  })
})
