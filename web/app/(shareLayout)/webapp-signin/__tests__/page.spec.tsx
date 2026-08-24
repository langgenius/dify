import { zSsoProtocol } from '@dify/contracts/api/console/system-features/zod.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessMode } from '@/models/access-control'
import { webAppLogout } from '@/service/webapp-auth'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import WebSSOForm from '../page'

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

const serviceMocks = vi.hoisted(() => ({
  fetchWebOAuth2SSOUrl: vi.fn(),
  fetchWebOIDCSSOUrl: vi.fn(),
  fetchWebSAMLSSOUrl: vi.fn(),
}))

const webAppState = {
  shareCode: 'share-app',
  webAppAccessMode: AccessMode.PUBLIC as AccessMode,
}

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: typeof webAppState) => unknown) => selector(webAppState),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: navigationMocks.push, replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('@/service/share', () => serviceMocks)

vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: vi.fn(),
}))

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('WebSSOForm redirect security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: 'https://evil.example/chatbot/evil-app',
    })
  })

  it('should use the login fallback when the redirect target is external', async () => {
    renderWithConsoleQuery(<WebSSOForm />, {
      systemFeatures: { webapp_auth: { enabled: true } },
    })

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith('/')
    })
  })

  it('should expose the unavailable-state fallback as a button', async () => {
    const user = userEvent.setup()
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: encodeURIComponent('/chatbot/share-app'),
    })
    window.history.replaceState({}, '', '/webapp-signin?redirect_url=%2Fchatbot%2Fshare-app')

    renderWithConsoleQuery(<WebSSOForm />, {
      systemFeatures: { webapp_auth: { enabled: true } },
    })

    await user.click(await screen.findByRole('button', { name: 'share.login.backToHome' }))

    expect(webAppLogout).toHaveBeenCalledWith({ kind: 'default', code: 'share-app' })
    expect(navigationMocks.replace).toHaveBeenCalledWith(
      '/webapp-signin?redirect_url=%2Fchatbot%2Fshare-app',
    )
  })
})

describe('WebSSOForm environment access modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: '/env/workflow/workflow-app',
    })
  })

  afterEach(() => {
    webAppState.webAppAccessMode = AccessMode.PUBLIC
  })

  it('should start web SSO for an sso verified environment webapp', async () => {
    webAppState.webAppAccessMode = AccessMode.EXTERNAL_MEMBERS
    serviceMocks.fetchWebSAMLSSOUrl.mockResolvedValue({ url: 'https://idp.example/authorize' })

    renderWithConsoleQuery(<WebSSOForm />, {
      systemFeatures: {
        webapp_auth: { enabled: true, sso_config: { protocol: zSsoProtocol.enum.saml } },
      },
    })

    await waitFor(() => {
      expect(serviceMocks.fetchWebSAMLSSOUrl).toHaveBeenCalledWith(
        'workflow-app',
        '/env/workflow/workflow-app',
      )
    })
    expect(navigationMocks.push).toHaveBeenCalledWith('https://idp.example/authorize')
  })
})
