import type { AppContextValue } from '@/context/app-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { useAppContext } from '@/context/app-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { ACCOUNT_SETTING_TAB } from './constants'
import AccountSetting from './index'

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

vi.mock('next/navigation', () => ({
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

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: vi.fn(() => ({ data: null, isLoading: false })),
  useUpdateDefaultModel: vi.fn(() => ({ trigger: vi.fn() })),
  useUpdateModelList: vi.fn(() => vi.fn()),
  useModelList: vi.fn(() => ({ data: [], isLoading: false })),
  useSystemDefaultModelAndModelList: vi.fn(() => [null, vi.fn()]),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: vi.fn(() => ({ data: { result: [] } })),
}))

vi.mock('@/service/use-common', () => ({
  useApiBasedExtensions: vi.fn(() => ({ data: [], isPending: false })),
  useMembers: vi.fn(() => ({ data: { accounts: [] }, refetch: vi.fn() })),
  useProviderContext: vi.fn(),
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
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )

      // Assert
      expect(screen.getByText('common.userProfile.settings')).toBeInTheDocument()
      expect(screen.getByText('common.settings.provider')).toBeInTheDocument()
      expect(screen.getAllByText('common.settings.members').length).toBeGreaterThan(0)
      expect(screen.getByText('common.settings.billing')).toBeInTheDocument()
      expect(screen.getByText('common.settings.dataSource')).toBeInTheDocument()
      expect(screen.getByText('common.settings.apiBasedExtension')).toBeInTheDocument()
      expect(screen.getByText('custom.custom')).toBeInTheDocument()
      expect(screen.getAllByText('common.settings.language').length).toBeGreaterThan(0)
    })

    it('should respect the activeTab prop', () => {
      // Act
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} activeTab={ACCOUNT_SETTING_TAB.DATA_SOURCE} />
        </QueryClientProvider>,
      )

      // Assert
      // Check that the active item title is Data Source
      const titles = screen.getAllByText('common.settings.dataSource')
      // One in sidebar, one in header.
      expect(titles.length).toBeGreaterThan(1)
    })

    it('should hide sidebar labels on mobile', () => {
      // Arrange
      vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)

      // Act
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )

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
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )

      // Assert
      expect(screen.queryByText('common.settings.provider')).not.toBeInTheDocument()
      expect(screen.queryByText('common.settings.members')).not.toBeInTheDocument()
      expect(screen.getByText('common.settings.language')).toBeInTheDocument()
    })

    it('should hide billing and custom tabs when disabled', () => {
      // Arrange
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        enableBilling: false,
        enableReplaceWebAppLogo: false,
      })

      // Act
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )

      // Assert
      expect(screen.queryByText('common.settings.billing')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.custom')).not.toBeInTheDocument()
    })
  })

  describe('Tab Navigation', () => {
    it('should change active tab when clicking on menu item', () => {
      // Arrange
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} onTabChange={mockOnTabChange} />
        </QueryClientProvider>,
      )

      // Act
      fireEvent.click(screen.getByText('common.settings.provider'))

      // Assert
      expect(mockOnTabChange).toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.PROVIDER)
      // Check for content from ModelProviderPage
      expect(screen.getByText('common.modelProvider.models')).toBeInTheDocument()
    })

    it('should navigate through various tabs and show correct details', () => {
      // Act & Assert
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )

      // Billing
      fireEvent.click(screen.getByText('common.settings.billing'))
      // Billing Page renders plansCommon.plan if data is loaded, or generic text.
      // Checking for title in header which is always there
      expect(screen.getAllByText('common.settings.billing').length).toBeGreaterThan(1)

      // Data Source
      fireEvent.click(screen.getByText('common.settings.dataSource'))
      expect(screen.getAllByText('common.settings.dataSource').length).toBeGreaterThan(1)

      // API Based Extension
      fireEvent.click(screen.getByText('common.settings.apiBasedExtension'))
      expect(screen.getAllByText('common.settings.apiBasedExtension').length).toBeGreaterThan(1)

      // Custom
      fireEvent.click(screen.getByText('custom.custom'))
      // Custom Page uses 'custom.custom' key as well.
      expect(screen.getAllByText('custom.custom').length).toBeGreaterThan(1)

      // Language
      fireEvent.click(screen.getAllByText('common.settings.language')[0])
      expect(screen.getAllByText('common.settings.language').length).toBeGreaterThan(1)

      // Members
      fireEvent.click(screen.getAllByText('common.settings.members')[0])
      expect(screen.getAllByText('common.settings.members').length).toBeGreaterThan(1)
    })
  })

  describe('Interactions', () => {
    it('should call onCancel when clicking close button', () => {
      // Act
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call onCancel when pressing Escape key', () => {
      // Act
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )
      fireEvent.keyDown(document, { key: 'Escape' })

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should update search value in provider tab', () => {
      // Arrange
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )
      fireEvent.click(screen.getByText('common.settings.provider'))

      // Act
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'test-search' } })

      // Assert
      expect(input).toHaveValue('test-search')
      expect(screen.getByText('common.modelProvider.models')).toBeInTheDocument()
    })

    it('should handle scroll event in panel', () => {
      // Act
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AccountSetting onCancel={mockOnCancel} />
        </QueryClientProvider>,
      )
      const scrollContainer = screen.getByRole('dialog').querySelector('.overflow-y-auto')

      // Assert
      expect(scrollContainer).toBeInTheDocument()
      if (scrollContainer) {
        // Scroll down
        fireEvent.scroll(scrollContainer, { target: { scrollTop: 100 } })
        expect(scrollContainer).toHaveClass('overflow-y-auto')

        // Scroll back up
        fireEvent.scroll(scrollContainer, { target: { scrollTop: 0 } })
      }
    })
  })
})
