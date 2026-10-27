import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ACCESS_TOKEN_LOCAL_STORAGE_NAME } from '@/config'
import { createDeferred } from '@/test/deferred'
import {
  beginWebAppAuthorizationRecovery,
  completeWebAppAuthorizationRecovery,
  expireWebAppAccountSession,
  getOrCreateWebAppSessionId,
  getWebAppAccessToken,
  getWebAppAuthSessionSnapshot,
  getWebAppLoginMode,
  getWebAppPassport,
  setWebAppAccessToken,
  setWebAppPassport,
  subscribeWebAppAuthSession,
  webAppLoginStatus,
  webAppLogout,
} from './webapp-auth'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const ordinary = { kind: 'default', code: 'workflow-app' } as const
const environment = { kind: 'environment', code: 'workflow-app' } as const

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/workflow/workflow-app')
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('Webapp credentials', () => {
  it('keeps environment and ordinary passports for the same code separate', () => {
    setWebAppPassport(environment, 'environment-passport')
    setWebAppPassport(ordinary, 'ordinary-passport')

    expect(getWebAppPassport(environment)).toBe('environment-passport')
    expect(getWebAppPassport(ordinary)).toBe('ordinary-passport')
    expect(localStorage.getItem('passport-workflow-app')).toBe('ordinary-passport')
  })

  it('keeps a stable anonymous session ID for each environment', () => {
    const firstEnvironment = { kind: 'environment', code: 'environment-1' } as const
    const secondEnvironment = { kind: 'environment', code: 'environment-2' } as const
    const first = getOrCreateWebAppSessionId(firstEnvironment)

    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getOrCreateWebAppSessionId(firstEnvironment)).toBe(first)
    expect(getOrCreateWebAppSessionId(secondEnvironment)).not.toBe(first)
  })

  it('allows one authorization recovery until an environment request succeeds', () => {
    expect(beginWebAppAuthorizationRecovery(environment)).toBe(true)
    expect(beginWebAppAuthorizationRecovery(environment)).toBe(false)
    setWebAppPassport(environment, 'renewed-passport')
    expect(beginWebAppAuthorizationRecovery(environment)).toBe(false)
    completeWebAppAuthorizationRecovery(environment)
    expect(beginWebAppAuthorizationRecovery(environment)).toBe(true)
  })

  it('clears every previous account Passport on login while preserving anonymous session IDs', () => {
    setWebAppAccessToken('account-a', 'end_user')
    setWebAppPassport(ordinary, 'account-a-ordinary')
    setWebAppPassport(environment, 'account-a-environment')
    const anonymousSession = getOrCreateWebAppSessionId(environment)
    beginWebAppAuthorizationRecovery(environment)
    const previousRevision = getWebAppAuthSessionSnapshot()
    const listener = vi.fn()
    const unsubscribe = subscribeWebAppAuthSession(listener)

    setWebAppAccessToken('account-b', 'end_user')

    expect(getWebAppAccessToken()).toBe('account-b')
    expect(getWebAppLoginMode()).toBe('end_user')
    expect(getWebAppPassport(ordinary)).toBe('')
    expect(getWebAppPassport(environment)).toBe('')
    expect(getOrCreateWebAppSessionId(environment)).toBe(anonymousSession)
    expect(beginWebAppAuthorizationRecovery(environment)).toBe(true)
    expect(getWebAppAuthSessionSnapshot()).not.toBe(previousRevision)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('retains the App Passport when the same login proof is restored', () => {
    setWebAppAccessToken('account-a', 'end_user')
    setWebAppPassport(ordinary, 'account-a-passport')
    const revision = getWebAppAuthSessionSnapshot()

    setWebAppAccessToken('account-a', 'end_user')

    expect(getWebAppAuthSessionSnapshot()).toBe(revision)
    expect(getWebAppPassport(ordinary)).toBe('account-a-passport')
  })

  it('distinguishes legacy SSO credentials from the new Account login proof', () => {
    localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, 'legacy-credential')
    expect(getWebAppLoginMode()).toBe('console')
    setWebAppAccessToken('account-proof', 'end_user')
    expect(getWebAppLoginMode()).toBe('end_user')
    expireWebAppAccountSession()
    expect(getWebAppAccessToken()).toBe('')
    expect(getWebAppLoginMode()).toBe('console')
  })

  it('notifies an identity change from another tab without deleting its newly issued Passport', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeWebAppAuthSession(listener)
    const revision = getWebAppAuthSessionSnapshot()
    localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, 'another-tab-proof')
    setWebAppPassport(ordinary, 'another-tab-passport')

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: ACCESS_TOKEN_LOCAL_STORAGE_NAME,
        newValue: 'another-tab-proof',
        storageArea: localStorage,
      }),
    )

    expect(getWebAppAuthSessionSnapshot()).not.toBe(revision)
    expect(listener).toHaveBeenCalledOnce()
    expect(getWebAppPassport(ordinary)).toBe('another-tab-passport')
    unsubscribe()
  })

  it('sends logout with the current proof, then clears all App credentials', async () => {
    setWebAppAccessToken('account-proof', 'end_user')
    setWebAppPassport(ordinary, 'ordinary-passport')
    setWebAppPassport(environment, 'environment-passport')
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ result: 'success' }))

    await webAppLogout(ordinary)

    const [, options] = fetch.mock.calls[0]!
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer account-proof')
    expect(getWebAppAccessToken()).toBe('')
    expect(getWebAppPassport(ordinary)).toBe('')
    expect(getWebAppPassport(environment)).toBe('')
  })

  it('clears local credentials and preserves a logout failure for its owner', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setWebAppAccessToken('account-proof', 'end_user')
    setWebAppPassport(ordinary, 'ordinary-passport')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(webAppLogout(ordinary)).rejects.toThrow()

    expect(getWebAppAccessToken()).toBe('')
    expect(getWebAppPassport(ordinary)).toBe('')
  })

  it.each(['success', 'failure'] as const)(
    'keeps another tab’s newer account when the old logout finishes with $0',
    async (outcome) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      setWebAppAccessToken('account-a', 'end_user')
      const response = createDeferred<Response>()
      const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(response.promise)
      const logout = webAppLogout(ordinary).catch((error: unknown) => error)
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce())

      localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, 'account-b')
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: ACCESS_TOKEN_LOCAL_STORAGE_NAME,
          newValue: 'account-b',
          storageArea: localStorage,
        }),
      )
      setWebAppPassport(ordinary, 'account-b-passport')
      setWebAppPassport(environment, 'account-b-environment-passport')
      const revision = getWebAppAuthSessionSnapshot()
      if (outcome === 'success') response.resolve(Response.json({ result: 'success' }))
      else response.reject(new TypeError('Failed to fetch'))
      await logout

      expect(getWebAppAccessToken()).toBe('account-b')
      expect(getWebAppLoginMode()).toBe('end_user')
      expect(getWebAppPassport(ordinary)).toBe('account-b-passport')
      expect(getWebAppPassport(environment)).toBe('account-b-environment-passport')
      expect(getWebAppAuthSessionSnapshot()).toBe(revision)
    },
  )

  it('does not send an old logout under an account that signs in while its client loads', async () => {
    setWebAppAccessToken('account-a', 'end_user')
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ result: 'success' }))
    const logout = webAppLogout(ordinary).catch((error: unknown) => error)
    setWebAppAccessToken('account-b', 'end_user')

    expect(await logout).toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    expect(getWebAppAccessToken()).toBe('account-b')
  })
})

describe('legacy Webapp login status', () => {
  it.each([
    { path: '/environment/workflow/workflow-app', appCode: null },
    { path: '/workflow/workflow-app', appCode: 'workflow-app' },
  ])('retains the existing status semantics for $path', async ({ path, appCode }) => {
    window.history.replaceState({}, '', path)
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ logged_in: true, app_logged_in: false }))

    await expect(webAppLoginStatus('workflow-app', 'user-1')).resolves.toEqual({
      userLoggedIn: true,
      appLoggedIn: false,
    })

    const [input] = fetch.mock.calls[0]!
    const url = new URL(input instanceof Request ? input.url : String(input))
    expect(url.searchParams.get('app_code')).toBe(appCode)
    expect(url.searchParams.get('user_id')).toBe('user-1')
    expect(url.searchParams.has('mode')).toBe(false)
  })
})
