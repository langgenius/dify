import type { AppContextValue } from '@/context/app-context'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
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

vi.mock('@/hooks/use-breakpoints', () => ({
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
  default: vi.fn(),
}))

// Mock sub-components to avoid deep rendering issues
vi.mock('./model-provider-page', () => ({ default: () => <div data-testid="model-provider-page">ModelProviderPage</div> }))
vi.mock('./members-page', () => ({ default: () => <div data-testid="members-page">MembersPage</div> }))
vi.mock('../../billing/billing-page', () => ({ default: () => <div data-testid="billing-page">BillingPage</div> }))
vi.mock('./data-source-page-new', () => ({ default: () => <div data-testid="data-source-page">DataSourcePage</div> }))
vi.mock('./api-based-extension-page', () => ({ default: () => <div data-testid="api-based-extension-page">ApiBasedExtensionPage</div> }))
vi.mock('../../custom/custom-page', () => ({ default: () => <div data-testid="custom-page">CustomPage</div> }))
vi.mock('./language-page', () => ({ default: () => <div data-testid="language-page">LanguagePage</div> }))

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

  it('renders the sidebar with correct menu items', () => {
    render(<AccountSetting onCancel={mockOnCancel} />)

    expect(screen.getByText('common.userProfile.settings')).toBeInTheDocument()
    expect(screen.getByText('common.settings.provider')).toBeInTheDocument()
    expect(screen.getAllByText('common.settings.members').length).toBeGreaterThan(0)
    expect(screen.getByText('common.settings.billing')).toBeInTheDocument()
    expect(screen.getByText('common.settings.dataSource')).toBeInTheDocument()
    expect(screen.getByText('common.settings.apiBasedExtension')).toBeInTheDocument()
    expect(screen.getByText('custom.custom')).toBeInTheDocument()
    expect(screen.getAllByText('common.settings.language').length).toBeGreaterThan(0)
  })

  it('changes active tab when clicking on menu item', () => {
    render(<AccountSetting onCancel={mockOnCancel} onTabChange={mockOnTabChange} />)

    fireEvent.click(screen.getByText('common.settings.provider'))

    expect(mockOnTabChange).toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.PROVIDER)
    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
  })

  it('calls onCancel when clicking close button', () => {
    render(<AccountSetting onCancel={mockOnCancel} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('calls onCancel when pressing Escape key', () => {
    render(<AccountSetting onCancel={mockOnCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('filters items for dataset operator', () => {
    vi.mocked(useAppContext).mockReturnValue({
      ...baseAppContextValue,
      isCurrentWorkspaceDatasetOperator: true,
    })

    render(<AccountSetting onCancel={mockOnCancel} />)

    expect(screen.queryByText('common.settings.provider')).not.toBeInTheDocument()
    expect(screen.queryByText('common.settings.members')).not.toBeInTheDocument()
    expect(screen.getByText('common.settings.language')).toBeInTheDocument()
  })

  it('hides billing and custom when disabled', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: false,
      enableReplaceWebAppLogo: false,
    })

    render(<AccountSetting onCancel={mockOnCancel} />)

    expect(screen.queryByText('common.settings.billing')).not.toBeInTheDocument()
    expect(screen.queryByText('custom.custom')).not.toBeInTheDocument()
  })

  it('shows custom tab when only enableReplaceWebAppLogo is true', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: false,
      enableReplaceWebAppLogo: true,
    })

    render(<AccountSetting onCancel={mockOnCancel} />)
    expect(screen.getByText('custom.custom')).toBeInTheDocument()
  })

  it('shows custom tab when only enableBilling is true', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: true,
      enableReplaceWebAppLogo: false,
    })

    render(<AccountSetting onCancel={mockOnCancel} />)
    expect(screen.getByText('custom.custom')).toBeInTheDocument()
  })

  it('updates search value in provider tab', () => {
    render(<AccountSetting onCancel={mockOnCancel} />)

    fireEvent.click(screen.getByText('common.settings.provider'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'test-search' } })

    expect(input).toHaveValue('test-search')
    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
  })

  it('handles scroll event in panel', () => {
    render(<AccountSetting onCancel={mockOnCancel} />)
    const scrollContainer = screen.getByRole('dialog').querySelector('.overflow-y-auto')

    expect(scrollContainer).toBeInTheDocument()

    if (scrollContainer) {
      // Scroll down
      fireEvent.scroll(scrollContainer, { target: { scrollTop: 100 } })
      expect(scrollContainer).toHaveClass('overflow-y-auto') // Class check to ensure it's the right element

      // Scroll back up
      fireEvent.scroll(scrollContainer, { target: { scrollTop: 0 } })
    }
  })

  it('respects the activeTab prop', () => {
    render(<AccountSetting onCancel={mockOnCancel} activeTab={ACCOUNT_SETTING_TAB.DATA_SOURCE} />)
    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
  })

  it('hides sidebar labels on mobile', () => {
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)
    render(<AccountSetting onCancel={mockOnCancel} />)

    // On mobile, the labels should not be rendered
    expect(screen.queryByText('common.settings.provider')).not.toBeInTheDocument()
  })

  it('navigates through all tabs and shows correct details', () => {
    render(<AccountSetting onCancel={mockOnCancel} />)

    // Billing
    fireEvent.click(screen.getByText('common.settings.billing'))
    expect(screen.getByTestId('billing-page')).toBeInTheDocument()
    expect(screen.getByTestId('billing-page')).toBeInTheDocument()

    // Data Source
    fireEvent.click(screen.getByText('common.settings.dataSource'))
    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()

    // API Based Extension
    fireEvent.click(screen.getByText('common.settings.apiBasedExtension'))
    expect(screen.getByTestId('api-based-extension-page')).toBeInTheDocument()

    // Custom
    fireEvent.click(screen.getByText('custom.custom'))
    expect(screen.getByTestId('custom-page')).toBeInTheDocument()

    // Language
    fireEvent.click(screen.getAllByText('common.settings.language')[0])
    expect(screen.getByTestId('language-page')).toBeInTheDocument()

    // Members
    fireEvent.click(screen.getAllByText('common.settings.members')[0])
    expect(screen.getByTestId('members-page')).toBeInTheDocument()
  })
})
