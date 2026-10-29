import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { AccountSettingTab } from '../constants'
import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedFeatures,
} from '@/test/console/query-data'
import { ACCOUNT_SETTING_TAB } from '../constants'
import AccountSetting from '../index'

const mockConfig = vi.hoisted(() => ({
  ENABLE_FEATURE_PREVIEW: true,
  ENABLE_HITL_IM: true,
  getFeatures: vi.fn<() => Promise<GetFeaturesResponse>>(),
}))
let canReplaceLogo = true

const mockConsoleState = vi.hoisted(() => ({
  current: null as unknown,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get ENABLE_FEATURE_PREVIEW() {
      return mockConfig.ENABLE_FEATURE_PREVIEW
    },
    get ENABLE_HITL_IM() {
      return mockConfig.ENABLE_HITL_IM
    },
  }
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState.current ?? {})
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current ?? {})
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

vi.mock('@/features/contacts/im-platform/account-setting-page', () => ({
  ContactsImPlatformAccountSettingPage: () => <div data-testid="contacts-im-platform-page" />,
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

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: vi.fn(() => ({ data: { result: [] } })),
}))

vi.mock('@/service/use-common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-common')>()
  return {
    ...actual,
    useMembers: vi.fn(() => ({ data: { accounts: [] }, refetch: vi.fn() })),
  }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const query = withConsoleResponses(actual.consoleQuery, {
    'workspaces.current.members.get': async () => ({ accounts: [] }),
  })
  return {
    ...actual,
    consoleQuery: new Proxy(query, {
      get(target, prop, receiver) {
        if (prop === 'features') {
          return {
            get: {
              queryKey: actual.consoleQuery.features.get.queryKey,
              queryOptions: (
                ...args: Parameters<typeof actual.consoleQuery.features.get.queryOptions>
              ) => ({
                ...actual.consoleQuery.features.get.queryOptions(...args),
                queryFn: mockConfig.getFeatures,
              }),
            },
          }
        }
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
    imCentrallyManaged?: boolean | 'missing' | 'pending'
  }) => {
    const {
      initialTab = ACCOUNT_SETTING_TAB.MEMBERS,
      onCancel = mockOnCancel,
      onTabChange = mockOnTabChange,
      rbacEnabled = true,
      deploymentEdition = 'CLOUD',
      imCentrallyManaged = false,
    } = props ?? {}
    const queryClient = createConsoleQueryClient()
    if (imCentrallyManaged !== 'pending') {
      const features = seedFeatures(queryClient, {
        billing: { subscription: { plan: 'sandbox' } },
        can_replace_logo: canReplaceLogo,
      })
      if (imCentrallyManaged !== 'missing') {
        const featuresWithIMBinding = {
          ...features,
          im_centrally_managed: imCentrallyManaged,
        }
        queryClient.setQueryData(consoleQuery.features.get.queryKey(), featuresWithIMBinding)
      }
    }

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
        queryClient,
        accountProfile: (mockConsoleState.current as ConsoleStateFixture).userProfile,
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
    mockConfig.ENABLE_FEATURE_PREVIEW = true
    mockConfig.ENABLE_HITL_IM = true
    mockConfig.getFeatures.mockImplementation(() => new Promise(() => {}))
    canReplaceLogo = true
    mockConsoleState.current = baseConsoleState
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.pc)
  })

  describe('Rendering', () => {
    it('hides workspace channels when centrally managed even in Community edition', () => {
      renderAccountSetting({ deploymentEdition: 'COMMUNITY', imCentrallyManaged: true })

      expect(
        screen.queryByRole('button', { name: 'contacts.imPlatform.title' }),
      ).not.toBeInTheDocument()
    })

    it('allows workspace channels in Enterprise edition when not centrally managed', () => {
      renderAccountSetting({
        initialTab: ACCOUNT_SETTING_TAB.IM_PLATFORM,
        deploymentEdition: 'ENTERPRISE',
        imCentrallyManaged: false,
      })

      expect(screen.getByRole('button', { name: 'contacts.imPlatform.title' })).toBeInTheDocument()
      expect(screen.getByTestId('contacts-im-platform-page')).toBeInTheDocument()
    })

    it('keeps workspace channels available for older successful features responses', () => {
      renderAccountSetting({ imCentrallyManaged: 'missing' })

      expect(screen.getByRole('button', { name: 'contacts.imPlatform.title' })).toBeInTheDocument()
    })

    it('does not open workspace channels before features have loaded', () => {
      renderAccountSetting({
        initialTab: ACCOUNT_SETTING_TAB.IM_PLATFORM,
        imCentrallyManaged: 'pending',
      })

      expect(
        screen.queryByRole('button', { name: 'contacts.imPlatform.title' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByTestId('contacts-im-platform-page')).not.toBeInTheDocument()
    })

    it('closes workspace channels if the features request becomes unavailable', async () => {
      const { queryClient } = renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.IM_PLATFORM })
      expect(screen.getByTestId('contacts-im-platform-page')).toBeInTheDocument()

      await act(async () => {
        mockConfig.getFeatures.mockRejectedValue(new Error('features unavailable'))
        await queryClient.invalidateQueries({ queryKey: consoleQuery.features.get.queryKey() })
      })

      await waitFor(() =>
        expect(screen.queryByTestId('contacts-im-platform-page')).not.toBeInTheDocument(),
      )
      expect(
        screen.queryByRole('button', { name: 'contacts.imPlatform.title' }),
      ).not.toBeInTheDocument()
    })

    it('hides the IM platform entry and rejects deep links when HITL IM is not released', () => {
      mockConfig.ENABLE_HITL_IM = false

      renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.IM_PLATFORM })

      expect(
        screen.queryByRole('button', { name: 'contacts.imPlatform.title' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByTestId('contacts-im-platform-page')).not.toBeInTheDocument()
      expect(screen.getAllByText('navigation.settings.members').length).toBeGreaterThan(0)
    })

    it('keeps released IM channels available when unrelated feature previews are disabled', () => {
      mockConfig.ENABLE_FEATURE_PREVIEW = false

      renderAccountSetting({ initialTab: ACCOUNT_SETTING_TAB.IM_PLATFORM })

      expect(screen.getByRole('button', { name: 'contacts.imPlatform.title' })).toBeInTheDocument()
      expect(screen.getByTestId('contacts-im-platform-page')).toBeInTheDocument()
    })

    it('rejects centrally managed workspace channels deep links', () => {
      renderAccountSetting({
        initialTab: ACCOUNT_SETTING_TAB.IM_PLATFORM,
        deploymentEdition: 'COMMUNITY',
        imCentrallyManaged: true,
      })

      expect(screen.queryByTestId('contacts-im-platform-page')).not.toBeInTheDocument()
      expect(screen.getAllByText('navigation.settings.members').length).toBeGreaterThan(0)
    })
  })

  describe('Tab Navigation', () => {
    it('should mount the Contacts-owned IM platform page from its entry', () => {
      renderAccountSetting()

      fireEvent.click(screen.getByRole('button', { name: 'contacts.imPlatform.title' }))

      expect(screen.getByTestId('contacts-im-platform-page')).toBeInTheDocument()
    })
  })
})
