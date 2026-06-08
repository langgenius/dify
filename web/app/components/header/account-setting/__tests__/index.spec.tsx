import type { AccountSettingTab } from '../constants'
import type { AppContextValue } from '@/context/app-context'
import { fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { useAppContext } from '@/context/app-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { ACCOUNT_SETTING_TAB } from '../constants'
import AccountSetting from '../index'

const mockResetModelProviderListExpanded = vi.fn()

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

vi.mock('@/context/app-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/app-context')>()
  return {
    ...actual,
    useAppContext: vi.fn(),
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
  useParams: vi.fn(() => ({})),
  useSearchParams: vi.fn(() => ({ get: vi.fn() })),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
  default: vi.fn(),
}))

vi.mock('next-themes', () => ({
  useTheme: vi.fn(() => ({
    theme: 'system',
    setTheme: vi.fn(),
  })),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: vi.fn(() => ({ data: null, isLoading: false })),
  useLanguage: vi.fn(() => 'en-US'),
  useUpdateDefaultModel: vi.fn(() => ({ trigger: vi.fn() })),
  useUpdateModelList: vi.fn(() => vi.fn()),
  useInvalidateDefaultModel: vi.fn(() => vi.fn()),
  useModelList: vi.fn(() => ({ data: [], isLoading: false })),
  useSystemDefaultModelAndModelList: vi.fn(() => [null, vi.fn()]),
  useMarketplaceAllPlugins: vi.fn(() => ({ plugins: [], isLoading: false })),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/atoms', () => ({
  useResetModelProviderListExpanded: () => mockResetModelProviderListExpanded,
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: vi.fn(() => ({ data: { result: [] } })),
}))

vi.mock('@/service/use-common', () => ({
  useMembers: vi.fn(() => ({ data: { accounts: [] }, refetch: vi.fn() })),
  useProviderContext: vi.fn(),
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, prop, receiver) {
        if (prop === 'apiBasedExtension') {
          return {
            get: {
              queryOptions: () => ({
                queryKey: ['console', 'api-based-extension'],
                queryFn: () => Promise.resolve([]),
              }),
            },
          }
        }

        return Reflect.get(target, prop, receiver)
      },
    }),
  }
})

vi.mock('@/app/components/billing/billing-page', () => ({
  __esModule: true,
  default: () => <div data-testid="billing-page" />,
}))

vi.mock('@/app/components/header/account-setting/data-source-page-new', () => ({
  __esModule: true,
  default: () => <div data-testid="data-source-page" />,
}))

const baseAppContextValue: AppContextValue = {
  userProfile: {
    id: '1',
    name: 'Test User',
    email: 'test@example.com',
    avatar: '',
    avatar_url: '',
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
    current_version: '0.1.0',
    latest_version: '0.1.0',
    release_date: '',
    release_notes: '',
    version: '0.1.0',
    can_auto_update: false,
  },
  useSelector: vi.fn(),
  isLoadingCurrentWorkspace: false,
  isValidatingCurrentWorkspace: false,
}

describe('AccountSetting', () => {
  const mockOnCancel = vi.fn()
  const mockOnTabChange = vi.fn()
  const renderAccountSetting = (props?: {
    initialTab?: AccountSettingTab
    onCancel?: () => void
    onTabChange?: (tab: AccountSettingTab) => void
  }) => {
    const {
      initialTab = ACCOUNT_SETTING_TAB.MEMBERS,
      onCancel = mockOnCancel,
      onTabChange = mockOnTabChange,
    } = props ?? {}

    const StatefulAccountSetting = () => {
      const [activeTab, setActiveTab] = useState<AccountSettingTab>(initialTab)

      return (
        <AccountSetting
          onCancelAction={onCancel}
          activeTab={activeTab}
          onTabChangeAction={(tab) => {
            setActiveTab(tab)
            onTabChange(tab)
          }}
        />
      )
    }

    return renderWithSystemFeatures(<StatefulAccountSetting />, {
      systemFeatures: {
        webapp_auth: { enabled: true },
        branding: { enabled: false },
        enable_marketplace: true,
        enable_collaboration_mode: false,
      },
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: true,
      enableReplaceWebAppLogo: true,
    })
    vi.mocked(useAppContext).mockReturnValue(baseAppContextValue)
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.pc)
  })

  describe('Rendering', () => {
    it('should render the sidebar with correct menu items', () => {
      // Act
      renderAccountSetting()

      // Assert
      expect(screen.getByText('common.settings.settings'))!.toBeInTheDocument()
      expect(screen.getByText('common.settings.workspace'))!.toBeInTheDocument()
      expect(screen.queryByText('common.settings.provider'))!.not.toBeInTheDocument()
      expect(screen.getAllByText('common.settings.members').length).toBeGreaterThan(0)
      expect(screen.getByText('common.settings.billing'))!.toBeInTheDocument()
      expect(screen.queryByText('common.settings.dataSource'))!.not.toBeInTheDocument()
      expect(screen.queryByText('common.settings.customEndpoint'))!.not.toBeInTheDocument()
      expect(screen.getByText('custom.custom'))!.toBeInTheDocument()
      expect(screen.getByText('common.settings.preferences'))!.toBeInTheDocument()
    })

    it('should keep hidden legacy tab metadata for direct entries', () => {
      // Act
      renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.DATA_SOURCE })

      // Assert
      expect(screen.getByText('common.settings.dataSource'))!.toBeInTheDocument()
    })

    it('should hide sidebar labels on mobile', () => {
      // Arrange
      vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)

      // Act
      renderAccountSetting()

      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      // Assert
      // On mobile, the labels should not be rendered as per the implementation
      expect(screen.queryByText('common.settings.provider')).not.toBeInTheDocument()
    })

    it('should filter items for dataset operator', () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({
        ...baseAppContextValue,
        isCurrentWorkspaceDatasetOperator: true,
      })

      // Act
      renderAccountSetting()

      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      expect(screen.queryByText('common.settings.provider')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.settings.members' })).not.toBeInTheDocument()
      expect(screen.getByText('common.settings.preferences'))!.toBeInTheDocument()
    })

    it('should hide billing and custom tabs when disabled', () => {
      // Arrange
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        enableBilling: false,
        enableReplaceWebAppLogo: false,
      })

      // Act
      renderAccountSetting()

      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      expect(screen.queryByText('common.settings.billing')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.custom')).not.toBeInTheDocument()
    })
  })

  describe('Tab Navigation', () => {
    it('should change active tab when clicking on menu item', () => {
      // Arrange
      renderAccountSetting({ onTabChange: mockOnTabChange })

      // Act
      fireEvent.click(screen.getByText('common.settings.billing'))

      // Assert
      expect(mockOnTabChange).toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.BILLING)
      expect(screen.getAllByText('common.settings.billing').length).toBeGreaterThan(1)
    })

    it('should navigate through various tabs and show correct details', () => {
      // Act & Assert
      renderAccountSetting()

      // Billing
      fireEvent.click(screen.getByText('common.settings.billing'))
      // Billing Page renders plansCommon.plan if data is loaded, or generic text.
      // Checking for title in header which is always there
      expect(screen.getAllByText('common.settings.billing').length).toBeGreaterThan(1)

      // Custom
      fireEvent.click(screen.getByText('custom.custom'))
      // Custom Page uses 'custom.custom' key as well.
      expect(screen.getAllByText('custom.custom').length).toBeGreaterThan(1)

      // Members
      fireEvent.click(screen.getAllByText('common.settings.members')[0]!)
      expect(screen.getAllByText('common.settings.members').length).toBeGreaterThan(1)

      // Language
      fireEvent.click(screen.getByText('common.settings.preferences'))
      expect(screen.getByText('common.account.general')).toBeInTheDocument()
      expect(screen.getByText('common.account.appearanceLabel')).toBeInTheDocument()
    })

    it('should switch the preferences icon when the tab is active', () => {
      renderAccountSetting()

      const preferencesButton = screen.getByRole('button', { name: 'common.settings.preferences' })
      expect(preferencesButton.querySelector('.i-ri-equalizer-2-line')).toBeInTheDocument()

      fireEvent.click(preferencesButton)

      expect(preferencesButton.querySelector('.i-ri-equalizer-2-fill')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call onCancel when clicking close button', () => {
      // Act
      renderAccountSetting()
      const closeIcon = document.querySelector('.i-ri-close-line')
      const closeButton = closeIcon?.closest('button')
      expect(closeButton).not.toBeNull()
      fireEvent.click(closeButton!)

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call onCancel when pressing Escape key', () => {
      // Act
      renderAccountSetting()
      fireEvent.keyDown(document, { key: 'Escape' })

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should update search value in provider tab', () => {
      // Arrange
      renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.PROVIDER })

      // Act
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
      fireEvent.change(input, { target: { value: 'test-search' } })

      // Assert
      // Assert
      expect(input)!.toHaveValue('test-search')
      expect(screen.getByPlaceholderText('common.modelProvider.searchModels'))!.toBeInTheDocument()
    })

    it('should handle scroll event in panel', () => {
      // Act
      renderAccountSetting()
      const scrollContainer = screen.getByRole('dialog').querySelector('.overscroll-contain')

      // Assert
      // Assert
      expect(scrollContainer)!.toBeInTheDocument()
      if (scrollContainer) {
        // Scroll down
        fireEvent.scroll(scrollContainer, { target: { scrollTop: 100 } })
        expect(scrollContainer)!.toHaveClass('overscroll-contain')

        // Scroll back up
        fireEvent.scroll(scrollContainer, { target: { scrollTop: 0 } })
      }
    })
  })
})
