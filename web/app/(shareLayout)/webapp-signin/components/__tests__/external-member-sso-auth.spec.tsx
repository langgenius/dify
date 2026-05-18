import { useSuspenseQuery } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import {
  fetchMembersOAuth2SSOUrl,
  fetchMembersOIDCSSOUrl,
  fetchMembersSAMLSSOUrl,
  fetchWebOAuth2SSOUrl,
  fetchWebOIDCSSOUrl,
  fetchWebSAMLSSOUrl,
} from '@/service/share'
import { SSOProtocol } from '@/types/feature'
import ExternalMemberSSOAuth from '../external-member-sso-auth'

const mockPush = vi.fn()
const mockUseSearchParams = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: vi.fn(),
}))

vi.mock('@/app/components/base/app-unavailable', () => ({
  default: () => <div data-testid="app-unavailable" />,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockUseSearchParams(),
}))

vi.mock('@/service/share', () => ({
  fetchMembersOAuth2SSOUrl: vi.fn(),
  fetchMembersOIDCSSOUrl: vi.fn(),
  fetchMembersSAMLSSOUrl: vi.fn(),
  fetchWebOAuth2SSOUrl: vi.fn(),
  fetchWebOIDCSSOUrl: vi.fn(),
  fetchWebSAMLSSOUrl: vi.fn(),
}))

vi.mock('@/service/system-features', () => ({
  systemFeaturesQueryOptions: () => ({}),
}))

const mockUseSuspenseQuery = vi.mocked(useSuspenseQuery)

const setSSOProtocol = (protocol: SSOProtocol) => {
  mockUseSuspenseQuery.mockReturnValue({
    data: {
      webapp_auth: {
        sso_config: {
          protocol,
        },
      },
    },
  } as ReturnType<typeof useSuspenseQuery>)
}

describe('ExternalMemberSSOAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearchParams.mockReturnValue(new URLSearchParams('redirect_url=%2Fchat%2Fapp-code'))
  })

  it.each([
    [SSOProtocol.SAML, fetchMembersSAMLSSOUrl, fetchWebSAMLSSOUrl],
    [SSOProtocol.OIDC, fetchMembersOIDCSSOUrl, fetchWebOIDCSSOUrl],
    [SSOProtocol.OAuth2, fetchMembersOAuth2SSOUrl, fetchWebOAuth2SSOUrl],
  ])('uses members SSO endpoint for external webapp %s auth', async (protocol, membersFetch, webFetch) => {
    setSSOProtocol(protocol)
    vi.mocked(membersFetch).mockResolvedValue({ url: `https://app.example/${protocol}` })
    vi.mocked(webFetch).mockResolvedValue({ url: `https://console.example/${protocol}` })

    render(<ExternalMemberSSOAuth />)

    await waitFor(() => {
      expect(membersFetch).toHaveBeenCalledWith('app-code', '/chat/app-code')
    })
    expect(webFetch).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith(`https://app.example/${protocol}`)
  })
})
