import { render, screen, waitFor } from '@testing-library/react'
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

describe('Splash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webAppState.shareCode = 'share-app'
    webAppState.webAppAccessMode = 'public'
    webAppState.embeddedUserId = 'embedded-user'
    navigationMocks.pathname = '/chatbot/share-app'
    window.history.replaceState({}, '', navigationMocks.pathname)
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

  it('should show the app unavailable state when a public Web App passport is not found', async () => {
    navigationMocks.searchParams = new URLSearchParams()
    webAppAuthMocks.webAppLoginStatus.mockResolvedValue({
      userLoggedIn: true,
      appLoggedIn: false,
    })
    fetchAccessTokenMock.mockRejectedValue(new Response(null, { status: 404 }))

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    expect(await screen.findByText('share.common.appUnavailable')).toBeInTheDocument()
  })

  it('should redirect an unauthenticated sso verified environment to the sign-in page', async () => {
    navigationMocks.searchParams = new URLSearchParams()
    navigationMocks.pathname = '/environment/chat/environment-app'
    window.history.replaceState({}, '', navigationMocks.pathname)
    webAppState.shareCode = 'environment-app'
    webAppState.webAppAccessMode = 'sso_verified'

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith(
        '/webapp-signin?redirect_url=%2Fenvironment%2Fchat%2Fenvironment-app',
      )
    })
    expect(fetchAccessTokenMock).not.toHaveBeenCalled()
    expect(screen.queryByText('share application')).not.toBeInTheDocument()
  })

  it('should redirect an sso verified environment when its passport cannot be issued', async () => {
    navigationMocks.searchParams = new URLSearchParams({
      query: 'keep-me',
      web_sso_token: 'expired-token',
    })
    navigationMocks.pathname = '/environment/chat/environment-app'
    window.history.replaceState({}, '', navigationMocks.pathname)
    webAppState.shareCode = 'environment-app'
    webAppState.webAppAccessMode = 'sso_verified'
    webAppAuthMocks.webAppLoginStatus.mockResolvedValue({
      userLoggedIn: true,
      appLoggedIn: false,
    })
    fetchAccessTokenMock.mockRejectedValue(new Response(null, { status: 401 }))

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith(
        '/webapp-signin?redirect_url=%2Fenvironment%2Fchat%2Fenvironment-app%3Fquery%3Dkeep-me',
      )
    })
    expect(webAppAuthMocks.webAppLogout).toHaveBeenCalledWith({
      kind: 'environment',
      code: 'environment-app',
    })
    expect(screen.queryByText('share application')).not.toBeInTheDocument()
  })

  it('should keep the existing authentication surface for an ordinary Web App', async () => {
    navigationMocks.searchParams = new URLSearchParams()

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    expect(await screen.findByText('share application')).toBeInTheDocument()
    expect(navigationMocks.replace).not.toHaveBeenCalled()
  })

  it('should expose the unavailable-state action as a button', () => {
    navigationMocks.searchParams = new URLSearchParams({
      code: '404',
      message: 'The Web App is unavailable.',
    })

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    expect(screen.getByRole('button', { name: 'share.login.backToHome' })).toBeInTheDocument()
  })
})
