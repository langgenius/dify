import type { AccountSettingTab } from '../constants'
import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ACCOUNT_SETTING_TAB } from '../constants'
import AccountSetting from '../index'

let canReplaceLogo = true

const mockFeatureFlags = vi.hoisted(() => ({ NEXT_PUBLIC_ENABLE_ACCESS_TOKEN: true }))

vi.mock('@/env', () => ({ env: mockFeatureFlags }))

const mockConsoleState = vi.hoisted(() => ({
  current: null as unknown,
}))

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

vi.mock('@/app/components/header/account-setting/model-provider-page', () => ({
  default: ({
    onSearchTextChange,
    searchText,
  }: {
    onSearchTextChange?: (value: string) => void
    searchText: string
  }) => (
    <input
      type="search"
      aria-label="common.operation.search"
      value={searchText}
      onChange={(event) => onSearchTextChange?.(event.target.value)}
    />
  ),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': async () => ({ accounts: [] }),
      'auth.plugin.datasource.list.get': async () => ({ result: [] }),
      'apiBasedExtension.get': async () => [],
    }),
  }
})

vi.mock('@/app/components/billing/billing-page', () => ({
  __esModule: true,
  default: () => <div data-testid="billing-page" />,
}))

vi.mock('@/app/components/custom/custom-page', () => ({
  __esModule: true,
  default: () => <div>custom.custom</div>,
}))

vi.mock('@/app/components/header/account-setting/data-source-page-new', () => ({
  __esModule: true,
  default: () => <div data-testid="data-source-page" />,
}))

vi.mock('@/app/components/header/account-setting/permissions-page', () => ({
  __esModule: true,
  default: () => <div data-testid="permissions-page" />,
}))

vi.mock('@/app/components/header/account-setting/access-rules-page', () => ({
  __esModule: true,
  default: () => <div data-testid="access-rules-page" />,
}))

vi.mock('@/app/components/header/account-setting/resource-access-token-page', () => ({
  __esModule: true,
  default: () => <div data-testid="resource-access-token-page" />,
}))

const baseConsoleState: ConsoleStateFixture = {
  userProfile: {
    id: '1',
    name: 'Test User',
    email: 'test@example.com',
    avatar: '',
    avatar_url: '',
    is_password_set: false,
  },
  currentWorkspace: {
    id: '1',
    name: 'Workspace',
    plan: null,
    role: 'owner',
  },
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  isCurrentWorkspaceDatasetOperator: false,
  refreshCurrentWorkspace: vi.fn(),
  isLoadingCurrentWorkspace: false,
  workspacePermissionKeys: [
    'workspace.member.manage',
    'workspace.role.manage',
    'data_source.manage',
    'api_extension.manage',
    'customization.manage',
  ],
}

describe('AccountSetting', () => {
  const mockOnCancel = vi.fn()
  const mockOnTabChange = vi.fn()
  const renderAccountSetting = (props?: {
    initialTab?: AccountSettingTab
    onCancel?: () => void
    onTabChange?: (tab: AccountSettingTab) => void
    rbacEnabled?: boolean
    deploymentEdition?: 'COMMUNITY' | 'ENTERPRISE' | 'CLOUD'
  }) => {
    const {
      initialTab = ACCOUNT_SETTING_TAB.MEMBERS,
      onCancel = mockOnCancel,
      onTabChange = mockOnTabChange,
      rbacEnabled = true,
      deploymentEdition = 'CLOUD',
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

    return renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <StatefulAccountSetting />
      </NuqsTestingAdapter>,
      {
        features: {
          billing: { subscription: { plan: 'sandbox' } },
          can_replace_logo: canReplaceLogo,
        },
        accountProfile: (mockConsoleState.current as ConsoleStateFixture).userProfile,
        currentWorkspace: (mockConsoleState.current as ConsoleStateFixture).currentWorkspace,
        workspacePermissionKeys: (mockConsoleState.current as ConsoleStateFixture)
          .workspacePermissionKeys,
        systemFeatures: {
          deployment_edition: deploymentEdition,
          webapp_auth: { enabled: true },
          branding: { enabled: false },
          enable_marketplace: true,
          enable_collaboration_mode: false,
          rbac_enabled: rbacEnabled,
        },
      },
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    canReplaceLogo = true
    mockFeatureFlags.NEXT_PUBLIC_ENABLE_ACCESS_TOKEN = true
    mockConsoleState.current = baseConsoleState
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.pc)
  })

  describe('Rendering', () => {
    it('should render the sidebar with correct menu items', () => {
      renderAccountSetting()

      expect(
        screen.getByRole('dialog', { name: 'navigation.settings.settings' }),
      ).toBeInTheDocument()
      expect(screen.getAllByText('navigation.settings.workspace').length).toBeGreaterThan(0)
      expect(screen.queryByText('navigation.settings.provider'))!.not.toBeInTheDocument()
      expect(screen.getAllByText('navigation.settings.members').length).toBeGreaterThan(0)
      expect(
        screen.getByRole('button', { name: 'navigation.settings.rolesAndPermissions' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.permissionSet' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.accessToken' }),
      ).toBeInTheDocument()
      expect(screen.getByText('navigation.settings.billing'))!.toBeInTheDocument()
      expect(screen.queryByText('navigation.settings.dataSource'))!.not.toBeInTheDocument()
      expect(screen.queryByText('navigation.settings.customEndpoint'))!.not.toBeInTheDocument()
      expect(screen.getByText('custom.custom'))!.toBeInTheDocument()
      expect(screen.getByText('navigation.settings.preferences'))!.toBeInTheDocument()
    })

    it('should hide billing from dataset operators', () => {
      const datasetOperatorContext = {
        ...baseConsoleState,
        currentWorkspace: {
          ...baseConsoleState.currentWorkspace,
          role: 'dataset_operator' as const,
        },
      }
      mockConsoleState.current = datasetOperatorContext

      renderAccountSetting()

      expect(
        screen.getByRole('button', { name: 'navigation.settings.members' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.rolesAndPermissions' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.permissionSet' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'navigation.settings.billing' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'custom.custom' })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.preferences' }),
      ).toBeInTheDocument()
    })

    it('should show custom tab when customization permission is missing', () => {
      const contextWithoutCustomizationPermission = {
        ...baseConsoleState,
        workspacePermissionKeys: baseConsoleState.workspacePermissionKeys!.filter(
          (key) => key !== 'customization.manage',
        ),
      }
      mockConsoleState.current = contextWithoutCustomizationPermission

      renderAccountSetting()

      expect(screen.queryByText('navigation.settings.provider')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.members' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'custom.custom' })).toBeInTheDocument()
      expect(screen.getByText('navigation.settings.preferences'))!.toBeInTheDocument()
    })

    it('should hide role and permission set entries when role management permission is missing', () => {
      const contextWithoutRoleManagePermission = {
        ...baseConsoleState,
        workspacePermissionKeys: baseConsoleState.workspacePermissionKeys!.filter(
          (key) => key !== 'workspace.role.manage',
        ),
      }
      mockConsoleState.current = contextWithoutRoleManagePermission

      renderAccountSetting()

      expect(
        screen.getByRole('button', { name: 'navigation.settings.members' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'navigation.settings.rolesAndPermissions' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'navigation.settings.permissionSet' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.accessToken' }),
      ).toBeInTheDocument()
    })

    it('should hide role and permission set entries when RBAC is disabled', () => {
      renderAccountSetting({ rbacEnabled: false })

      expect(
        screen.getByRole('button', { name: 'navigation.settings.members' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'navigation.settings.rolesAndPermissions' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'navigation.settings.permissionSet' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.accessToken' }),
      ).toBeInTheDocument()
    })

    it('should hide access tokens and fall back to members when the feature is disabled', () => {
      mockFeatureFlags.NEXT_PUBLIC_ENABLE_ACCESS_TOKEN = false

      renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.ACCESS_TOKEN })

      expect(
        screen.queryByRole('button', { name: 'navigation.settings.accessToken' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByTestId('resource-access-token-page')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'navigation.settings.members' }),
      ).toBeInTheDocument()
    })

    it('should hide access tokens from non-owner workspaces', () => {
      mockConsoleState.current = {
        ...baseConsoleState,
        currentWorkspace: {
          ...baseConsoleState.currentWorkspace,
          role: 'admin' as const,
        },
        isCurrentWorkspaceOwner: false,
      }

      renderAccountSetting()

      expect(
        screen.queryByRole('button', { name: 'navigation.settings.accessToken' }),
      ).not.toBeInTheDocument()
    })

    it('should not render direct role pages when RBAC is disabled', () => {
      renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.PERMISSION_SET, rbacEnabled: false })

      expect(screen.queryByTestId('access-rules-page')).not.toBeInTheDocument()
      expect(screen.queryByTestId('permissions-page')).not.toBeInTheDocument()
      expect(screen.getAllByText('navigation.settings.members').length).toBeGreaterThan(0)
    })

    it('should hide billing and custom tabs when disabled', () => {
      canReplaceLogo = false

      renderAccountSetting({ deploymentEdition: 'COMMUNITY' })

      expect(screen.queryByText('navigation.settings.billing')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.custom')).not.toBeInTheDocument()
    })

    it('should show billing to regular members without billing permission keys', () => {
      const regularMemberContext = {
        ...baseConsoleState,
        currentWorkspace: {
          ...baseConsoleState.currentWorkspace,
          role: 'normal' as const,
        },
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        isCurrentWorkspaceDatasetOperator: false,
        workspacePermissionKeys: [],
      }
      mockConsoleState.current = regularMemberContext

      renderAccountSetting()

      expect(
        screen.getByRole('button', { name: 'navigation.settings.billing' }),
      ).toBeInTheDocument()
    })

    it('should hide workflow log archives outside cloud edition', () => {
      renderAccountSetting({ deploymentEdition: 'COMMUNITY' })

      expect(
        screen.queryByRole('button', { name: 'appLog.archives.title' }),
      ).not.toBeInTheDocument()
    })

    it('should hide workflow log archives from custom RBAC roles that are not owner or admin', () => {
      const contextWithRoleManagePermissionButNotManager = {
        ...baseConsoleState,
        currentWorkspace: {
          ...baseConsoleState.currentWorkspace,
          role: 'normal' as const,
        },
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        workspacePermissionKeys: [
          ...(baseConsoleState.workspacePermissionKeys ?? []),
          'workspace.role.manage',
        ],
      }
      mockConsoleState.current = contextWithRoleManagePermissionButNotManager

      renderAccountSetting()

      expect(
        screen.queryByRole('button', { name: 'appLog.archives.title' }),
      ).not.toBeInTheDocument()
    })

    it('should not render workflow log archives page outside cloud edition', () => {
      renderAccountSetting({
        initialTab: ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES,
        deploymentEdition: 'COMMUNITY',
      })

      expect(screen.queryByText('appLog.archives.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.getAllByText('navigation.settings.members').length).toBeGreaterThan(0)
    })

    it('should render a direct billing entry for regular members without billing permission keys', () => {
      const regularMemberContext = {
        ...baseConsoleState,
        currentWorkspace: {
          ...baseConsoleState.currentWorkspace,
          role: 'normal' as const,
        },
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        isCurrentWorkspaceDatasetOperator: false,
        workspacePermissionKeys: [],
      }
      mockConsoleState.current = regularMemberContext

      renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.BILLING })

      expect(screen.getByTestId('billing-page')).toBeInTheDocument()
    })

    it('should not render a direct billing entry for dataset operators', () => {
      mockConsoleState.current = {
        ...baseConsoleState,
        currentWorkspace: {
          ...baseConsoleState.currentWorkspace,
          role: 'dataset_operator' as const,
        },
      }

      renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.BILLING })

      expect(screen.queryByTestId('billing-page')).not.toBeInTheDocument()
    })
  })

  describe('Tab Navigation', () => {
    it('should navigate through various tabs and show correct details', async () => {
      const user = userEvent.setup()

      renderAccountSetting()

      await user.click(screen.getByText('navigation.settings.billing'))

      expect(screen.getByTestId('billing-page')).toBeInTheDocument()
      expect(mockOnTabChange).toHaveBeenLastCalledWith(ACCOUNT_SETTING_TAB.BILLING)

      await user.click(screen.getByText('custom.custom'))

      expect(screen.getAllByText('custom.custom').length).toBeGreaterThan(1)

      await user.click(screen.getByRole('button', { name: 'appLog.archives.title' }))
      expect(screen.getByText('appLog.archives.upgradeTip.title')).toBeInTheDocument()

      await user.click(screen.getAllByText('navigation.settings.members')[0]!)
      expect(
        screen.getByRole('button', { name: 'navigation.settings.members' }),
      ).toBeInTheDocument()

      await user.click(
        screen.getByRole('button', { name: 'navigation.settings.rolesAndPermissions' }),
      )
      expect(screen.getByTestId('permissions-page')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'navigation.settings.permissionSet' }))
      expect(screen.getByText('navigation.settings.permissionSetDescription')).toBeInTheDocument()
      expect(screen.getByTestId('access-rules-page')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'navigation.settings.accessToken' }))
      expect(screen.getByTestId('resource-access-token-page')).toBeInTheDocument()

      await user.click(screen.getByText('navigation.settings.preferences'))
      expect(screen.getByText('accountSettings.account.general')).toBeInTheDocument()
      expect(screen.getByText('accountSettings.account.appearanceLabel')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call onCancel when clicking close button', async () => {
      const user = userEvent.setup()
      renderAccountSetting()
      const dialog = screen.getByRole('dialog', { name: 'navigation.settings.settings' })

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))

      expect(mockOnCancel).toHaveBeenCalled()
    })
  })
})
