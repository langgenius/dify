import { fireEvent, render, screen } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useAppContext } from '@/context/app-context'
import { useIsLogin } from '@/service/use-common'
import { useAuthorizeOAuthApp, useOAuthAppInfo } from '@/service/use-oauth'
import { storage } from '@/utils/storage'
import { OAUTH_AUTHORIZE_PENDING_KEY, OAUTH_AUTHORIZE_PENDING_TTL, REDIRECT_URL_KEY } from './constants'
import OAuthAuthorize from './page'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useIsLogin: vi.fn(),
}))

vi.mock('@/service/use-oauth', () => ({
  useAuthorizeOAuthApp: vi.fn(),
  useOAuthAppInfo: vi.fn(),
}))

const FIXED_DATE = new Date('2026-02-10T12:00:00.000Z')
const SEARCH_QUERY = 'client_id=dcfcd6a4-5799-405a-a6d7-04261b24dd02&redirect_uri=https%3A%2F%2Fcreators.dify.dev%2Fapi%2Fv1%2Foauth%2Fcallback%2Fdify&response_type=code'

const createOAuthAppInfo = () => ({
  app_label: {
    en_US: 'Test OAuth App',
  },
  scope: 'read:name',
  app_icon: '',
})

describe('OAuthAuthorize redirect persistence', () => {
  const push = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    storage.resetCache()
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_DATE)

    vi.mocked(useRouter).mockReturnValue({
      push,
    } as never)
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(SEARCH_QUERY) as never)
    vi.mocked(useLanguage).mockReturnValue('en_US')
    vi.mocked(useAppContext).mockReturnValue({
      userProfile: {
        avatar_url: '',
        name: 'Dify User',
        email: 'dify@example.com',
      },
    } as never)
    vi.mocked(useOAuthAppInfo).mockReturnValue({
      data: createOAuthAppInfo(),
      isLoading: false,
      isError: false,
    } as never)
    vi.mocked(useAuthorizeOAuthApp).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should store full authorize url and navigate to signin when switch account is clicked', () => {
    // Arrange
    vi.mocked(useIsLogin).mockReturnValue({
      isLoading: false,
      data: { logged_in: true },
    } as never)
    render(<OAuthAuthorize />)
    const switchAccountButton = screen.getByRole('button', { name: 'oauth.switchAccount' })

    // Act
    fireEvent.click(switchAccountButton)

    // Assert
    const expectedStoredReturnUrl = `${window.location.origin}/account/oauth/authorize?${SEARCH_QUERY}`
    const expectedDecodedReturnUrl = decodeURIComponent(expectedStoredReturnUrl)
    expect(push).toHaveBeenCalledTimes(1)
    const pushedUrl = push.mock.calls[0][0] as string
    const pushedParams = new URLSearchParams(pushedUrl.split('?')[1])
    expect(pushedParams.has(REDIRECT_URL_KEY)).toBe(true)
    expect(decodeURIComponent(pushedParams.get(REDIRECT_URL_KEY)!)).toBe(expectedDecodedReturnUrl)

    const storedPendingRedirect = storage.get<{ value: string, expiry: number }>(OAUTH_AUTHORIZE_PENDING_KEY)
    expect(storedPendingRedirect).toEqual({
      value: expectedStoredReturnUrl,
      expiry: Math.floor((FIXED_DATE.getTime() + OAUTH_AUTHORIZE_PENDING_TTL * 1000) / 1000),
    })
  })

  it('should store full authorize url and navigate to signin when login button is clicked for logged-out users', () => {
    // Arrange
    vi.mocked(useIsLogin).mockReturnValue({
      isLoading: false,
      data: { logged_in: false },
    } as never)
    render(<OAuthAuthorize />)
    const loginButton = screen.getByRole('button', { name: 'oauth.login' })

    // Act
    fireEvent.click(loginButton)

    // Assert
    const expectedReturnUrl = `${window.location.origin}/account/oauth/authorize?${SEARCH_QUERY}`
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(`/signin?${REDIRECT_URL_KEY}=${encodeURIComponent(expectedReturnUrl)}`)
    expect(storage.get<{ value: string }>(OAUTH_AUTHORIZE_PENDING_KEY)?.value).toBe(expectedReturnUrl)
  })
})
