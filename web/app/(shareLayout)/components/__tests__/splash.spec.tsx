import { act, render, screen, waitFor } from '@testing-library/react'
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
const ipAccessState = vi.hoisted(() => ({
  scope: {},
  isCurrent: true,
  isDenied: false,
  deniedError: new Error('IP access denied'),
}))

const routerMock = { replace: navigationMocks.replace }

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
  useRouter: () => routerMock,
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('@/features/app-access-error/state', () => ({
  captureAppAccessScope: () => ipAccessState.scope,
  hasAppAccessError: () => ipAccessState.isDenied,
  isAppAccessScopeCurrent: () => ipAccessState.isCurrent,
  isAppAccessError: (error: unknown) => error === ipAccessState.deniedError,
}))

vi.mock('@/service/share', () => ({
  fetchAccessToken: (...args: unknown[]) => fetchAccessTokenMock(...args),
}))

vi.mock('@/service/webapp-auth', () => webAppAuthMocks)

describe('Splash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchAccessTokenMock.mockReset()
    webAppAuthMocks.webAppLogout.mockResolvedValue(undefined)
    ipAccessState.isCurrent = true
    ipAccessState.isDenied = false
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

  it.each(['login status', 'passport'])(
    'should stop initialization when %s is denied by IP policy',
    async (request) => {
      navigationMocks.searchParams = new URLSearchParams()
      if (request === 'login status') {
        webAppAuthMocks.webAppLoginStatus.mockRejectedValue(ipAccessState.deniedError)
      } else {
        webAppAuthMocks.webAppLoginStatus.mockResolvedValue({
          userLoggedIn: true,
          appLoggedIn: false,
        })
        fetchAccessTokenMock.mockRejectedValue(ipAccessState.deniedError)
      }

      await act(async () => {
        render(
          <Splash>
            <div>share application</div>
          </Splash>,
        )
      })

      expect(webAppAuthMocks.webAppLoginStatus).toHaveBeenCalledTimes(1)
      expect(webAppAuthMocks.webAppLogout).not.toHaveBeenCalled()
      expect(webAppAuthMocks.setWebAppPassport).not.toHaveBeenCalled()
      expect(navigationMocks.replace).not.toHaveBeenCalled()
      expect(screen.queryByText('share application')).not.toBeInTheDocument()
      expect(screen.queryByText('share.common.appUnavailable')).not.toBeInTheDocument()
    },
  )

  it('should show an unavailable state when login status fails without allowing the app to load', async () => {
    navigationMocks.searchParams = new URLSearchParams()
    webAppAuthMocks.webAppLoginStatus.mockRejectedValue(new Response(null, { status: 503 }))

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    expect(await screen.findByText('share.common.appUnknownError')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '503' })).toBeInTheDocument()
    expect(fetchAccessTokenMock).not.toHaveBeenCalled()
    expect(webAppAuthMocks.webAppLogout).not.toHaveBeenCalled()
    expect(navigationMocks.replace).not.toHaveBeenCalled()
    expect(screen.queryByText('share application')).not.toBeInTheDocument()
  })

  it('should keep authentication and block initialization when the passport policy service is unavailable', async () => {
    navigationMocks.searchParams = new URLSearchParams()
    webAppAuthMocks.webAppLoginStatus.mockResolvedValue({
      userLoggedIn: true,
      appLoggedIn: false,
    })
    fetchAccessTokenMock.mockRejectedValue(
      Response.json({ code: 'policy_unavailable' }, { status: 503 }),
    )

    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )

    expect(await screen.findByText('share.common.appUnknownError')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '503' })).toBeInTheDocument()
    expect(webAppAuthMocks.webAppLogout).not.toHaveBeenCalled()
    expect(webAppAuthMocks.setWebAppPassport).not.toHaveBeenCalled()
    expect(navigationMocks.replace).not.toHaveBeenCalled()
    expect(screen.queryByText('share application')).not.toBeInTheDocument()
  })

  it.each(['IP denial', 'navigation', 'unmount'])(
    'should ignore login status received after %s',
    async (interruption) => {
      navigationMocks.searchParams = new URLSearchParams()
      let finishLogin!: (value: { userLoggedIn: boolean; appLoggedIn: boolean }) => void
      webAppAuthMocks.webAppLoginStatus.mockReturnValue(
        new Promise((resolve) => {
          finishLogin = resolve
        }),
      )
      const { unmount } = render(
        <Splash>
          <div>share application</div>
        </Splash>,
      )

      if (interruption === 'IP denial') ipAccessState.isDenied = true
      else if (interruption === 'navigation') ipAccessState.isCurrent = false
      else unmount()

      await act(async () => {
        finishLogin({ userLoggedIn: true, appLoggedIn: false })
      })

      expect(fetchAccessTokenMock).not.toHaveBeenCalled()
      expect(webAppAuthMocks.webAppLogout).not.toHaveBeenCalled()
      expect(navigationMocks.replace).not.toHaveBeenCalled()
      expect(screen.queryByText('share application')).not.toBeInTheDocument()
    },
  )

  it.each(['IP denial', 'navigation', 'unmount'])(
    'should ignore a passport received after %s',
    async (interruption) => {
      navigationMocks.searchParams = new URLSearchParams()
      webAppAuthMocks.webAppLoginStatus.mockResolvedValue({
        userLoggedIn: true,
        appLoggedIn: false,
      })
      let finishPassport!: (value: { access_token: string }) => void
      fetchAccessTokenMock.mockReturnValue(
        new Promise((resolve) => {
          finishPassport = resolve
        }),
      )
      const { unmount } = render(
        <Splash>
          <div>share application</div>
        </Splash>,
      )
      await waitFor(() => expect(fetchAccessTokenMock).toHaveBeenCalledTimes(1))

      if (interruption === 'IP denial') ipAccessState.isDenied = true
      else if (interruption === 'navigation') ipAccessState.isCurrent = false
      else unmount()

      await act(async () => {
        finishPassport({ access_token: 'late-passport' })
      })

      expect(webAppAuthMocks.setWebAppPassport).not.toHaveBeenCalled()
      expect(webAppAuthMocks.webAppLogout).not.toHaveBeenCalled()
      expect(navigationMocks.replace).not.toHaveBeenCalled()
      expect(screen.queryByText('share application')).not.toBeInTheDocument()
    },
  )

  it('should not sign out after a pending passport fails following IP denial', async () => {
    navigationMocks.searchParams = new URLSearchParams()
    webAppAuthMocks.webAppLoginStatus.mockResolvedValue({
      userLoggedIn: true,
      appLoggedIn: false,
    })
    let rejectPassport!: (error: Response) => void
    fetchAccessTokenMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPassport = reject
      }),
    )
    render(
      <Splash>
        <div>share application</div>
      </Splash>,
    )
    await waitFor(() => expect(fetchAccessTokenMock).toHaveBeenCalledTimes(1))

    ipAccessState.isDenied = true
    await act(async () => {
      rejectPassport(new Response(null, { status: 401 }))
    })

    expect(webAppAuthMocks.webAppLogout).not.toHaveBeenCalled()
    expect(navigationMocks.replace).not.toHaveBeenCalled()
    expect(screen.queryByText('share application')).not.toBeInTheDocument()
  })
})
