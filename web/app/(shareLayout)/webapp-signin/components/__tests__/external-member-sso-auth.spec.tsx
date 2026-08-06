import { zSsoProtocol } from '@dify/contracts/api/console/system-features/zod.gen'
import { screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import ExternalMemberSSOAuth from '../external-member-sso-auth'

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

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: navigationMocks.push,
    replace: navigationMocks.replace,
  }),
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('@/service/share', () => serviceMocks)

describe('ExternalMemberSSOAuth redirect security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: 'https://evil.example/chatbot/evil-app',
    })
  })

  it('should show unavailable without starting SSO when the protocol is not configured', () => {
    renderWithConsoleQuery(<ExternalMemberSSOAuth />, {
      systemFeatures: { webapp_auth: { sso_config: { protocol: null } } },
    })

    expect(screen.getByText('sso protocol is invalid.')).toBeInTheDocument()
    expect(serviceMocks.fetchWebSAMLSSOUrl).not.toHaveBeenCalled()
    expect(serviceMocks.fetchWebOIDCSSOUrl).not.toHaveBeenCalled()
    expect(serviceMocks.fetchWebOAuth2SSOUrl).not.toHaveBeenCalled()
  })

  it('should use the login fallback without calling SSO when the redirect target is external', async () => {
    renderWithConsoleQuery(<ExternalMemberSSOAuth />, {
      systemFeatures: {
        webapp_auth: { sso_config: { protocol: zSsoProtocol.enum.saml } },
      },
    })

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith('/')
    })
    expect(serviceMocks.fetchWebSAMLSSOUrl).not.toHaveBeenCalled()
    expect(serviceMocks.fetchWebOIDCSSOUrl).not.toHaveBeenCalled()
    expect(serviceMocks.fetchWebOAuth2SSOUrl).not.toHaveBeenCalled()
  })

  it.each([
    [zSsoProtocol.enum.saml, serviceMocks.fetchWebSAMLSSOUrl],
    [zSsoProtocol.enum.oidc, serviceMocks.fetchWebOIDCSSOUrl],
    [zSsoProtocol.enum.oauth2, serviceMocks.fetchWebOAuth2SSOUrl],
  ])('should send the sanitized redirect target to %s SSO', async (protocol, serviceMock) => {
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: encodeURIComponent('/chatbot/share-app?foo=bar'),
    })
    serviceMock.mockResolvedValue({ url: 'https://idp.example/authorize' })

    renderWithConsoleQuery(<ExternalMemberSSOAuth />, {
      systemFeatures: { webapp_auth: { sso_config: { protocol } } },
    })

    await waitFor(() => {
      expect(serviceMock).toHaveBeenCalledWith('share-app', '/chatbot/share-app?foo=bar')
    })
    expect(navigationMocks.push).toHaveBeenCalledWith('https://idp.example/authorize')
  })
})
