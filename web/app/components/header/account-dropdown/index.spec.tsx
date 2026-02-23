import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { AppContextValue } from '@/context/app-context'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useLogout } from '@/service/use-common'
import AppSelector from './index'

vi.mock('../account-setting', () => ({
  default: () => <div data-testid="account-setting">AccountSetting</div>,
}))

vi.mock('../account-about', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="account-about">
      Version
      <button onClick={onCancel}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/header/github-star', () => ({
  default: () => <div data-testid="github-star">GithubStar</div>,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

// Mock config and env
const { mockConfig, mockEnv } = vi.hoisted(() => ({
  mockConfig: {
    IS_CLOUD_EDITION: false,
  },
  mockEnv: {
    env: {
      NEXT_PUBLIC_SITE_ABOUT: 'show',
    },
  },
}))
vi.mock('@/config', () => ({
  get IS_CLOUD_EDITION() { return mockConfig.IS_CLOUD_EDITION },
  IS_DEV: false,
  IS_CE_EDITION: false,
}))
vi.mock('@/env', () => mockEnv)

const baseAppContextValue: AppContextValue = {
  userProfile: {
    id: '1',
    name: 'Test User',
    email: 'test@example.com',
    avatar: '',
    avatar_url: 'avatar.png',
    is_password_set: false,
  },
  mutateUserProfile: vi.fn(),
  currentWorkspace: {
    id: '1',
    name: 'Workspace',
    plan: '',
    status: '',
    created_at: 0,
    role: 'owner',
    providers: [],
    trial_credits: 0,
    trial_credits_used: 0,
    next_credit_reset_date: 0,
  },
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  isCurrentWorkspaceEditor: true,
  isCurrentWorkspaceDatasetOperator: false,
  mutateCurrentWorkspace: vi.fn(),
  langGeniusVersionInfo: {
    current_env: 'testing',
    current_version: '0.6.0',
    latest_version: '0.6.0',
    release_date: '',
    release_notes: '',
    version: '0.6.0',
    can_auto_update: false,
  },
  useSelector: vi.fn(),
  isLoadingCurrentWorkspace: false,
  isValidatingCurrentWorkspace: false,
}

describe('AccountDropdown', () => {
  const mockPush = vi.fn()
  const mockLogout = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()

  const renderWithRouter = (ui: React.ReactElement) => {
    const mockRouter = {
      push: mockPush,
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    } as unknown as AppRouterInstance

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    return render(
      <QueryClientProvider client={queryClient}>
        <AppRouterContext.Provider value={mockRouter}>
          {ui}
        </AppRouterContext.Provider>
      </QueryClientProvider>,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', { removeItem: vi.fn() })
    mockConfig.IS_CLOUD_EDITION = false
    mockEnv.env.NEXT_PUBLIC_SITE_ABOUT = 'show'

    vi.mocked(useAppContext).mockReturnValue(baseAppContextValue)
    vi.mocked(useGlobalPublicStore).mockImplementation((selector?: unknown) => {
      const fullState = { systemFeatures: { branding: { enabled: false } }, setSystemFeatures: vi.fn() }
      return typeof selector === 'function' ? (selector as (state: typeof fullState) => unknown)(fullState) : fullState
    })
    vi.mocked(useProviderContext).mockReturnValue({
      isEducationAccount: false,
      plan: { type: Plan.sandbox },
    } as unknown as ProviderContextState)
    vi.mocked(useModalContext).mockReturnValue({
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
    vi.mocked(useLogout).mockReturnValue({
      mutateAsync: mockLogout,
    } as unknown as ReturnType<typeof useLogout>)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Rendering', () => {
    it('should render user profile correctly', () => {
      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.getByText('Test User')).toBeInTheDocument()
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
    })

    it('should show EDU badge for education accounts', () => {
      // Arrange
      vi.mocked(useProviderContext).mockReturnValue({
        isEducationAccount: true,
        plan: { type: Plan.sandbox },
      } as unknown as ProviderContextState)

      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.getByText('EDU')).toBeInTheDocument()
    })
  })

  describe('Settings and Support', () => {
    it('should trigger setShowAccountSettingModal when settings is clicked', () => {
      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByText('common.userProfile.settings'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalled()
    })

    it('should show Compliance in Cloud Edition for workspace owner', () => {
      // Arrange
      mockConfig.IS_CLOUD_EDITION = true
      vi.mocked(useAppContext).mockReturnValue({
        ...baseAppContextValue,
        userProfile: { ...baseAppContextValue.userProfile, name: 'User' },
        isCurrentWorkspaceOwner: true,
        langGeniusVersionInfo: { ...baseAppContextValue.langGeniusVersionInfo, current_version: '0.6.0', latest_version: '0.6.0' },
      })

      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.getByText('common.userProfile.compliance')).toBeInTheDocument()
    })
  })

  describe('Actions', () => {
    it('should handle logout correctly', async () => {
      // Arrange
      mockLogout.mockResolvedValue({})

      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByText('common.userProfile.logout'))

      // Assert
      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalled()
        expect(localStorage.removeItem).toHaveBeenCalledWith('setup_status')
        expect(mockPush).toHaveBeenCalledWith('/signin')
      })
    })

    it('should show About section when about button is clicked and can close it', () => {
      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByText('common.userProfile.about'))

      // Assert
      expect(screen.getByTestId('account-about')).toBeInTheDocument()

      // Act
      fireEvent.click(screen.getByText('Close'))

      // Assert
      expect(screen.queryByTestId('account-about')).not.toBeInTheDocument()
    })
  })

  describe('Branding and Environment', () => {
    it('should hide sections when branding is enabled', () => {
      // Arrange
      vi.mocked(useGlobalPublicStore).mockImplementation((selector?: unknown) => {
        const fullState = { systemFeatures: { branding: { enabled: true } }, setSystemFeatures: vi.fn() }
        return typeof selector === 'function' ? (selector as (state: typeof fullState) => unknown)(fullState) : fullState
      })

      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.queryByText('common.userProfile.helpCenter')).not.toBeInTheDocument()
      expect(screen.queryByText('common.userProfile.roadmap')).not.toBeInTheDocument()
    })

    it('should hide About section when NEXT_PUBLIC_SITE_ABOUT is hide', () => {
      // Arrange
      mockEnv.env.NEXT_PUBLIC_SITE_ABOUT = 'hide'

      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.queryByText('common.userProfile.about')).not.toBeInTheDocument()
    })
  })

  describe('Version Indicators', () => {
    it('should show orange indicator when version is not latest', () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({
        ...baseAppContextValue,
        userProfile: { ...baseAppContextValue.userProfile, name: 'User' },
        langGeniusVersionInfo: {
          ...baseAppContextValue.langGeniusVersionInfo,
          current_version: '0.6.0',
          latest_version: '0.7.0',
        },
      })

      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      const indicator = screen.getByTestId('status-indicator')
      expect(indicator).toHaveClass('bg-components-badge-status-light-warning-bg')
    })

    it('should show green indicator when version is latest', () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({
        ...baseAppContextValue,
        userProfile: { ...baseAppContextValue.userProfile, name: 'User' },
        langGeniusVersionInfo: {
          ...baseAppContextValue.langGeniusVersionInfo,
          current_version: '0.7.0',
          latest_version: '0.7.0',
        },
      })

      // Act
      renderWithRouter(<AppSelector />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      const indicator = screen.getByTestId('status-indicator')
      expect(indicator).toHaveClass('bg-components-badge-status-light-success-bg')
    })
  })
})
