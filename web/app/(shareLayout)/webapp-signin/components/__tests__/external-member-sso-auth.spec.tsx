import { waitFor } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { SSOProtocol } from '@/features/system-features/constants'
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

  it('should use the login fallback without calling SSO when the redirect target is external', async () => {
    renderWithSystemFeatures(<ExternalMemberSSOAuth />, {
      systemFeatures: {
        webapp_auth: { sso_config: { protocol: SSOProtocol.SAML } },
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
    [SSOProtocol.SAML, serviceMocks.fetchWebSAMLSSOUrl],
    [SSOProtocol.OIDC, serviceMocks.fetchWebOIDCSSOUrl],
    [SSOProtocol.OAuth2, serviceMocks.fetchWebOAuth2SSOUrl],
  ])('should send the sanitized redirect target to %s SSO', async (protocol, serviceMock) => {
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: encodeURIComponent('/chatbot/share-app?foo=bar'),
    })
    serviceMock.mockResolvedValue({ url: 'https://idp.example/authorize' })

    renderWithSystemFeatures(<ExternalMemberSSOAuth />, {
      systemFeatures: { webapp_auth: { sso_config: { protocol } } },
    })

    await waitFor(() => {
      expect(serviceMock).toHaveBeenCalledWith('share-app', '/chatbot/share-app?foo=bar')
    })
    expect(navigationMocks.push).toHaveBeenCalledWith('https://idp.example/authorize')
  })
})
