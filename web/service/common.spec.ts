import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  OAUTH_REGISTRATION_GA_SENT_KEY,
  REGISTRATION_SUCCESS_STORAGE_KEY,
} from '@/app/components/base/amplitude/registration-session-state'
import { emailLoginWithCode, sendEMailLoginCode } from './common'
import { useLogout } from './use-common'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}))

vi.mock('./base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: mocks.post,
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
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('discards registration delivery state after a successful logout', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['account-profile'], { id: 'previous-user' })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'pending-marker')
    window.sessionStorage.setItem(OAUTH_REGISTRATION_GA_SENT_KEY, 'true')
    mocks.post.mockResolvedValueOnce({ result: 'success' })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(() => useLogout(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(OAUTH_REGISTRATION_GA_SENT_KEY)).toBeNull()
    expect(queryClient.getQueryData(['account-profile'])).toBeUndefined()
  })
})
