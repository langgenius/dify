import { render, waitFor } from '@testing-library/react'
import Splash from '../splash'

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/chatbot/share-app',
  searchParams: new URLSearchParams(),
}))

const webAppAuthMocks = vi.hoisted(() => ({
  setWebAppAccessToken: vi.fn(),
  setWebAppPassport: vi.fn(),
  webAppLoginStatus: vi.fn(),
  webAppLogout: vi.fn(),
}))

const fetchAccessTokenMock = vi.hoisted(() => vi.fn())

const webAppState: {
  shareCode: string | null
  webAppAccessMode: string
  embeddedUserId: string
} = {
  shareCode: 'share-app',
  webAppAccessMode: 'public',
  embeddedUserId: 'embedded-user',
}

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: typeof webAppState) => unknown) => selector(webAppState),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => navigationMocks.pathname,
  useRouter: () => ({ replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('@/service/share', () => ({
  fetchAccessToken: (...args: unknown[]) => fetchAccessTokenMock(...args),
}))

vi.mock('@/service/webapp-auth', () => webAppAuthMocks)

describe('Splash redirect security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webAppState.shareCode = 'share-app'
    navigationMocks.pathname = '/chatbot/share-app'
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: 'https://evil.example/chatbot/evil-app',
    })
    webAppAuthMocks.webAppLoginStatus.mockResolvedValue({
      userLoggedIn: false,
      appLoggedIn: false,
    })
  })

  it('should use the login fallback without checking auth when the redirect target is external', async () => {
    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith('/')
    })
    expect(webAppAuthMocks.webAppLoginStatus).not.toHaveBeenCalled()
    expect(fetchAccessTokenMock).not.toHaveBeenCalled()
  })

  it('should use the login fallback without checking auth when redirect_url is empty', async () => {
    navigationMocks.searchParams = new URLSearchParams('redirect_url=')

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith('/')
    })
    expect(webAppAuthMocks.webAppLoginStatus).not.toHaveBeenCalled()
    expect(fetchAccessTokenMock).not.toHaveBeenCalled()
  })

  it('should use the fallback without checking auth when the sign-in page has no target', async () => {
    navigationMocks.searchParams = new URLSearchParams()
    navigationMocks.pathname = '/webapp-signin'
    webAppState.shareCode = null

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith('/')
    })
    expect(webAppAuthMocks.webAppLoginStatus).not.toHaveBeenCalled()
    expect(fetchAccessTokenMock).not.toHaveBeenCalled()
  })

  it('should fall back before checking auth when a nested sign-in route has stale share state', async () => {
    navigationMocks.searchParams = new URLSearchParams()
    navigationMocks.pathname = '/webapp-signin/check-code'
    webAppState.shareCode = 'previous-share-app'

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith('/')
    })
    expect(webAppAuthMocks.webAppLoginStatus).not.toHaveBeenCalled()
    expect(fetchAccessTokenMock).not.toHaveBeenCalled()
  })
})
