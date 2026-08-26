import { zSsoProtocol } from '@dify/contracts/api/console/system-features/zod.gen'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SSOAuth from '../sso-auth'

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

const serviceMocks = vi.hoisted(() => ({
  fetchMembersOAuth2SSOUrl: vi.fn(),
  fetchMembersOIDCSSOUrl: vi.fn(),
  fetchMembersSAMLSSOUrl: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: navigationMocks.push,
    replace: navigationMocks.replace,
  }),
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('@/service/share', () => serviceMocks)

describe('SSOAuth redirect security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: 'https://evil.example/chatbot/evil-app',
    })
  })

  it('should use the login fallback without calling SSO when the redirect target is external', async () => {
    render(<SSOAuth protocol={zSsoProtocol.enum.saml} />)

    fireEvent.click(screen.getByRole('button', { name: 'login.withSSO' }))

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith('/')
    })
    expect(serviceMocks.fetchMembersSAMLSSOUrl).not.toHaveBeenCalled()
    expect(serviceMocks.fetchMembersOIDCSSOUrl).not.toHaveBeenCalled()
    expect(serviceMocks.fetchMembersOAuth2SSOUrl).not.toHaveBeenCalled()
  })

  it.each([
    [zSsoProtocol.enum.saml, serviceMocks.fetchMembersSAMLSSOUrl],
    [zSsoProtocol.enum.oidc, serviceMocks.fetchMembersOIDCSSOUrl],
    [zSsoProtocol.enum.oauth2, serviceMocks.fetchMembersOAuth2SSOUrl],
  ])('should send the sanitized redirect target to %s SSO', async (protocol, serviceMock) => {
    navigationMocks.searchParams = new URLSearchParams({
      redirect_url: encodeURIComponent('/chatbot/share-app?foo=bar'),
    })
    serviceMock.mockResolvedValue({ url: 'https://idp.example/authorize' })
    render(<SSOAuth protocol={protocol} />)

    fireEvent.click(screen.getByRole('button', { name: 'login.withSSO' }))

    await waitFor(() => {
      expect(serviceMock).toHaveBeenCalledWith('share-app', '/chatbot/share-app?foo=bar')
    })
    expect(navigationMocks.push).toHaveBeenCalledWith('https://idp.example/authorize')
  })
})
