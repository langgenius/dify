import type { ComponentProps, ReactNode } from 'react'
import type { AppContextValue } from '@/context/app-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useAppContext } from '@/context/app-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { ACCOUNT_SETTING_TAB } from '../constants'
import AccountSetting from '../index'

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

vi.mock('@/app/components/billing/billing-page', () => ({
  default: () => <div data-testid="billing-page">Billing Page</div>,
}))

vi.mock('@/app/components/custom/custom-page', () => ({
  default: () => <div data-testid="custom-page">Custom Page</div>,
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page', () => ({
  default: () => <div data-testid="api-based-extension-page">API Based Extension Page</div>,
}))

vi.mock('@/app/components/header/account-setting/data-source-page-new', () => ({
  default: () => <div data-testid="data-source-page">Data Source Page</div>,
}))

vi.mock('@/app/components/header/account-setting/language-page', () => ({
  default: () => <div data-testid="language-page">Language Page</div>,
}))

vi.mock('@/app/components/header/account-setting/members-page', () => ({
  default: () => <div data-testid="members-page">Members Page</div>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page', () => ({
  default: ({ searchText }: { searchText: string }) => (
    <div data-testid="provider-page">
      {`provider-search:${searchText}`}
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/menu-dialog', () => ({
  default: function MockMenuDialog({
    children,
    onClose,
    show,
  }: {
    children: ReactNode
    onClose: () => void
    show?: boolean
  }) {
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape')
          onClose()
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => {
        document.removeEventListener('keydown', handleKeyDown)
      }
    }, [onClose])

    if (!show)
      return null

    return <div role="dialog">{children}</div>
  },
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

  const renderAccountSetting = (props: Partial<ComponentProps<typeof AccountSetting>> = {}) => {
    const queryClient = new QueryClient()
    const mergedProps: ComponentProps<typeof AccountSetting> = {
      onCancel: mockOnCancel,
      ...props,
    }

    const view = render(
      <QueryClientProvider client={queryClient}>
        <AccountSetting {...mergedProps} />
      </QueryClientProvider>,
    )

    return {
      ...view,
      rerenderAccountSetting(nextProps: Partial<ComponentProps<typeof AccountSetting>>) {
        view.rerender(
          <QueryClientProvider client={queryClient}>
            <AccountSetting {...mergedProps} {...nextProps} />
          </QueryClientProvider>,
        )
      },
    }
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
      renderAccountSetting()

      expect(screen.getByText('common.userProfile.settings')).toBeInTheDocument()
      expect(screen.getByTitle('common.settings.provider')).toBeInTheDocument()
      expect(screen.getByTitle('common.settings.members')).toBeInTheDocument()
      expect(screen.getByTitle('common.settings.billing')).toBeInTheDocument()
      expect(screen.getByTitle('common.settings.dataSource')).toBeInTheDocument()
      expect(screen.getByTitle('common.settings.apiBasedExtension')).toBeInTheDocument()
      expect(screen.getByTitle('custom.custom')).toBeInTheDocument()
      expect(screen.getByTitle('common.settings.language')).toBeInTheDocument()
      expect(screen.getByTestId('members-page')).toBeInTheDocument()
    })

    it('should respect the activeTab prop', () => {
      renderAccountSetting({ activeTab: ACCOUNT_SETTING_TAB.DATA_SOURCE })

      expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
    })

    it('should sync the rendered page when activeTab changes', async () => {
      const { rerenderAccountSetting } = renderAccountSetting({
        activeTab: ACCOUNT_SETTING_TAB.DATA_SOURCE,
      })

      expect(screen.getByTestId('data-source-page')).toBeInTheDocument()

      rerenderAccountSetting({
        activeTab: ACCOUNT_SETTING_TAB.CUSTOM,
      })

      await waitFor(() => {
        expect(screen.getByTestId('custom-page')).toBeInTheDocument()
      })
    })

    it('should hide sidebar labels on mobile', () => {
      vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)

      renderAccountSetting()

      expect(screen.queryByText('common.settings.provider')).not.toBeInTheDocument()
    })

    it('should filter items for dataset operator', () => {
      vi.mocked(useAppContext).mockReturnValue({
        ...baseAppContextValue,
        isCurrentWorkspaceDatasetOperator: true,
      })

      renderAccountSetting()

      expect(screen.queryByTitle('common.settings.provider')).not.toBeInTheDocument()
      expect(screen.queryByTitle('common.settings.members')).not.toBeInTheDocument()
      expect(screen.getByTitle('common.settings.language')).toBeInTheDocument()
    })

    it('should hide billing and custom tabs when disabled', () => {
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        enableBilling: false,
        enableReplaceWebAppLogo: false,
      })

      renderAccountSetting()

      expect(screen.queryByTitle('common.settings.billing')).not.toBeInTheDocument()
      expect(screen.queryByTitle('custom.custom')).not.toBeInTheDocument()
    })
  })

  describe('Tab Navigation', () => {
    it('should change active tab when clicking on a menu item', async () => {
      const user = userEvent.setup()

      renderAccountSetting({ onTabChange: mockOnTabChange })

      await user.click(screen.getByTitle('common.settings.provider'))

      expect(mockOnTabChange).toHaveBeenCalledWith(ACCOUNT_SETTING_TAB.PROVIDER)
      expect(screen.getByTestId('provider-page')).toBeInTheDocument()
    })

    it.each([
      ['common.settings.billing', 'billing-page'],
      ['common.settings.dataSource', 'data-source-page'],
      ['common.settings.apiBasedExtension', 'api-based-extension-page'],
      ['custom.custom', 'custom-page'],
      ['common.settings.language', 'language-page'],
      ['common.settings.members', 'members-page'],
    ])('should render the "%s" page when its sidebar item is selected', async (menuTitle, pageTestId) => {
      const user = userEvent.setup()

      renderAccountSetting()

      await user.click(screen.getByTitle(menuTitle))

      expect(screen.getByTestId(pageTestId)).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call onCancel when clicking the close button', async () => {
      const user = userEvent.setup()

      renderAccountSetting()

      const closeControls = screen.getByText('ESC').parentElement

      expect(closeControls).not.toBeNull()
      if (!closeControls)
        throw new Error('Close controls are missing')

      await user.click(within(closeControls).getByRole('button'))

      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call onCancel when pressing Escape key', () => {
      renderAccountSetting()

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should update search value in the provider tab', async () => {
      const user = userEvent.setup()

      renderAccountSetting()

      await user.click(screen.getByTitle('common.settings.provider'))

      const input = screen.getByRole('textbox')
      await user.type(input, 'test-search')

      expect(input).toHaveValue('test-search')
      expect(screen.getByText('provider-search:test-search')).toBeInTheDocument()
    })

    it('should handle scroll event in panel', () => {
      renderAccountSetting()

      const scrollContainer = screen.getByRole('dialog').querySelector('.overflow-y-auto')

      expect(scrollContainer).toBeInTheDocument()
      if (scrollContainer) {
        fireEvent.scroll(scrollContainer, { target: { scrollTop: 100 } })
        expect(scrollContainer).toHaveClass('overflow-y-auto')

        fireEvent.scroll(scrollContainer, { target: { scrollTop: 0 } })
      }
    })
  })
})
