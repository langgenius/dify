import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessMode } from '@/models/access-control'
import { webAppLogout } from '@/service/webapp-auth'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import WebSSOForm from '../page'

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

const webAppState = {
  shareCode: 'share-app',
  webAppAccessMode: AccessMode.PUBLIC,
}

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: typeof webAppState) => unknown) => selector(webAppState),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: vi.fn(),
}))

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

    renderWithConsoleQuery(<WebSSOForm />, {
      systemFeatures: { webapp_auth: { enabled: true } },
    })

    await user.click(await screen.findByRole('button', { name: 'share.login.backToHome' }))

    expect(webAppLogout).toHaveBeenCalledWith('share-app')
    expect(navigationMocks.replace).toHaveBeenCalledWith(
      '/webapp-signin?redirect_url=%2Fchatbot%2Fshare-app',
    )
  })
})
