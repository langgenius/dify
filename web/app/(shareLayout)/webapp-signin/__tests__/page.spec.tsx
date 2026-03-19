import { render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import WebSSOForm from '../page'

const mockReplace = vi.fn()
let mockRedirectUrl = '/share/test-share-code'
let mockWebAppAccessMode: AccessMode | null = null
let mockSystemFeaturesEnabled = true

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => ({
    get: (key: string) => key === 'redirect_url' ? mockRedirectUrl : null,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { webapp_auth: { enabled: boolean } } }) => unknown) =>
    selector({
      systemFeatures: {
        webapp_auth: {
          enabled: mockSystemFeaturesEnabled,
        },
      },
    }),
}))

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: { webAppAccessMode: AccessMode | null, shareCode: string | null }) => unknown) =>
    selector({
      webAppAccessMode: mockWebAppAccessMode,
      shareCode: 'test-share-code',
    }),
}))

vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: vi.fn(),
}))

vi.mock('../normalForm', () => ({
  default: () => <div data-testid="normal-form" />,
}))

vi.mock('../components/external-member-sso-auth', () => ({
  default: () => <div data-testid="external-member-sso-auth" />,
}))

describe('WebSSOForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedirectUrl = '/share/test-share-code'
    mockWebAppAccessMode = null
    mockSystemFeaturesEnabled = true
  })

  describe('Access Mode Resolution', () => {
    it('should avoid rendering auth variants before the access mode query resolves', () => {
      render(<WebSSOForm />)

      expect(screen.queryByTestId('normal-form')).not.toBeInTheDocument()
      expect(screen.queryByTestId('external-member-sso-auth')).not.toBeInTheDocument()
      expect(screen.queryByText('share.login.backToHome')).not.toBeInTheDocument()
    })

    it('should render the normal form for organization-backed access modes', () => {
      mockWebAppAccessMode = AccessMode.ORGANIZATION

      render(<WebSSOForm />)

      expect(screen.getByTestId('normal-form')).toBeInTheDocument()
    })
  })
})
