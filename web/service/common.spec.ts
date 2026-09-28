import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  OAUTH_REGISTRATION_GA_SENT_KEY,
  REGISTRATION_SUCCESS_STORAGE_KEY,
} from '@/app/components/base/amplitude/registration-session-state'
import { clearPageLeaveGuards, registerPageLeaveGuard } from '@/utils/page-leave-guard'
import { emailLoginWithCode, sendEMailLoginCode } from './common'
import { useLogout } from './use-common'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  request: vi.fn(),
  resetUser: vi.fn(),
  basePath: '',
}))

vi.mock('./base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: mocks.post,
  request: mocks.request,
}))

vi.mock('@/app/components/base/amplitude/utils', () => ({ resetUser: mocks.resetUser }))
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return mocks.basePath
  },
}))

describe('sendEMailLoginCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes the Turnstile token when provided', async () => {
    await sendEMailLoginCode('user@example.com', 'en-US', 'turnstile-token')

    expect(mocks.post).toHaveBeenCalledWith('/email-code-login', {
      body: {
        email: 'user@example.com',
        language: 'en-US',
        turnstile_token: 'turnstile-token',
      },
    })
  })

  it('omits the Turnstile token when it is not provided', async () => {
    await sendEMailLoginCode('user@example.com', 'en-US')

    expect(mocks.post).toHaveBeenCalledWith('/email-code-login', {
      body: {
        email: 'user@example.com',
        language: 'en-US',
      },
    })
  })
})

describe('emailLoginWithCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes the verification-specific Turnstile token when provided', async () => {
    await emailLoginWithCode({
      code: 'encrypted-code',
      email: 'user@example.com',
      language: 'en-US',
      timezone: 'Asia/Singapore',
      token: 'email-login-token',
      turnstile_token: 'verify-turnstile-token',
    })

    expect(mocks.post).toHaveBeenCalledWith('/email-code-login/validity', {
      body: {
        code: 'encrypted-code',
        email: 'user@example.com',
        language: 'en-US',
        timezone: 'Asia/Singapore',
        token: 'email-login-token',
        turnstile_token: 'verify-turnstile-token',
      },
    })
  })
})

describe('useLogout', () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: new QueryClient() }, children)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.basePath = ''
    window.sessionStorage.clear()
  })

  afterEach(() => {
    clearPageLeaveGuards()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(['', '/console'])(
    'clears persisted session identity and replaces the document with base path "%s"',
    async (basePath) => {
      mocks.basePath = basePath
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'pending-marker')
      window.sessionStorage.setItem(OAUTH_REGISTRATION_GA_SENT_KEY, 'true')
      let finishLogout!: (response: Response) => void
      mocks.request.mockReturnValue(
        new Promise<Response>((resolve) => {
          finishLogout = resolve
        }),
      )
      const { result } = renderHook(() => useLogout(), { wrapper })
      let logout!: Promise<unknown>
      await act(async () => {
        logout = result.current.mutateAsync()
      })
      expect(replace).not.toHaveBeenCalled()
      expect(mocks.resetUser).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe('pending-marker')

      await act(async () => {
        finishLogout(new Response(JSON.stringify({ result: 'success' }), { status: 200 }))
        await logout
      })

      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
      expect(window.sessionStorage.getItem(OAUTH_REGISTRATION_GA_SENT_KEY)).toBeNull()
      expect(mocks.resetUser).toHaveBeenCalledOnce()
      expect(replace).toHaveBeenCalledExactlyOnceWith(`${basePath}/signin`)
    },
  )

  it('does not end the session when the user keeps an unsaved draft', async () => {
    registerPageLeaveGuard({ message: 'Discard draft?', shouldBlock: () => true })
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'pending-marker')
    const { result } = renderHook(() => useLogout(), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('Logout cancelled')
    })

    expect(confirm).toHaveBeenCalledExactlyOnceWith('Discard draft?')
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.resetUser).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe('pending-marker')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })

  it('confirms before logout and releases the guard only after success', async () => {
    registerPageLeaveGuard({ message: 'Discard draft?', shouldBlock: () => true })
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    let finishLogout!: (response: Response) => void
    mocks.request.mockImplementation(() => {
      expect(confirm).toHaveBeenCalledOnce()
      const unload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(true)
      return new Promise<Response>((resolve) => {
        finishLogout = resolve
      })
    })
    const unloadListener = vi.fn()
    window.addEventListener('beforeunload', unloadListener)
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {
      const unload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(false)
    })
    const { result } = renderHook(() => useLogout(), { wrapper })
    let logout!: Promise<unknown>
    await act(async () => {
      logout = result.current.mutateAsync()
    })
    expect(replace).not.toHaveBeenCalled()
    await act(async () => {
      finishLogout(new Response(JSON.stringify({ result: 'success' }), { status: 200 }))
      await logout
    })
    expect(replace).toHaveBeenCalledExactlyOnceWith('/signin')
    // Autosave/lock-release listeners remain attached; only confirmation guards are removed.
    expect(unloadListener).toHaveBeenCalledTimes(2)
    window.removeEventListener('beforeunload', unloadListener)
  })

  it('preserves the OAuth return URL across the document replacement', async () => {
    mocks.basePath = '/console'
    mocks.request.mockResolvedValue(
      new Response(JSON.stringify({ result: 'success' }), { status: 200 }),
    )
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const redirectTo = `/signin?redirect_url=${encodeURIComponent('/console/account/oauth/authorize?client_id=app&state=value')}`
    const { result } = renderHook(() => useLogout({ redirectTo }), { wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })
    expect(replace).toHaveBeenCalledExactlyOnceWith(`/console${redirectTo}`)
  })

  it('keeps the session identity and current document when logout fails', async () => {
    registerPageLeaveGuard({ message: 'Discard draft?', shouldBlock: () => true })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    mocks.request.mockRejectedValue(new Error('Logout failed'))
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'pending-marker')
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const { result } = renderHook(() => useLogout(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('Logout failed')
    })
    expect(replace).not.toHaveBeenCalled()
    expect(mocks.resetUser).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe('pending-marker')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })
})
