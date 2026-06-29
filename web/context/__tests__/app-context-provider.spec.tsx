import { render, screen } from '@testing-library/react'
import { useAppContext, useSelector } from '../app-context'
import { AppContextProvider } from '../app-context-provider'

const mockInvalidateQueries = vi.hoisted(() => vi.fn())
const mockPermissionKeysState = vi.hoisted(() => ({
  isPending: false,
  permissionKeys: ['app.create_and_management'],
}))
const mockCurrentWorkspaceResponse = vi.hoisted(() => ({
  id: 'workspace-1',
  name: 'Workspace',
  plan: 'sandbox',
  status: 'normal',
  created_at: 1704067200,
  role: 'editor',
  trial_credits: 200,
  trial_credits_used: 0,
  next_credit_reset_date: 1706745600,
  custom_config: {},
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
  useSuspenseQuery: (options: { queryKey?: readonly unknown[] }) => {
    if (options.queryKey?.[0] === 'system-features') {
      return {
        data: {
          branding: {
            enabled: false,
          },
        },
      }
    }

    return {
      data: {
        profile: {
          id: 'user-1',
          name: 'User',
          email: 'user@example.com',
          avatar: '',
          avatar_url: '',
          is_password_set: true,
        },
        meta: {
          currentVersion: '1.0.0',
          currentEnv: 'cloud',
        },
      },
    }
  },
  useQuery: (options: { select?: (workspace: typeof mockCurrentWorkspaceResponse) => unknown }) => ({
    data: options.select ? options.select(mockCurrentWorkspaceResponse) : mockCurrentWorkspaceResponse,
    isFetching: false,
    isPending: false,
  }),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
  }),
}))

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['user-profile'],
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        post: {
          key: () => ['current-workspace'],
          queryOptions: (options: Record<string, unknown>) => ({
            queryKey: ['current-workspace'],
            ...options,
          }),
        },
      },
    },
  },
}))

vi.mock('@/service/access-control/use-permission-keys', () => ({
  useWorkspacePermissionKeys: () => ({
    data: {
      workspace: {
        permission_keys: mockPermissionKeysState.permissionKeys,
      },
      app: {
        default_permission_keys: [],
        overrides: [],
      },
      dataset: {
        default_permission_keys: [],
        overrides: [],
      },
    },
    isPending: mockPermissionKeysState.isPending,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useLangGeniusVersion: () => ({
    data: {
      version: '1.0.1',
      release_date: '',
      release_notes: '',
      can_auto_update: false,
    },
  }),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  setUserId: vi.fn(),
  setUserProperties: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude/registration-tracking', () => ({
  flushRegistrationSuccess: vi.fn(),
}))

vi.mock('@/app/components/base/zendesk/utils', () => ({
  setZendeskConversationFields: vi.fn(),
}))

vi.mock('@/app/components/header/maintenance-notice', () => ({
  default: () => null,
}))

function AppContextProbe() {
  const context = useAppContext()
  const selectedWorkspacePermissionKeys = useSelector(state => state.workspacePermissionKeys)

  return (
    <>
      <span>
        keys:
        {selectedWorkspacePermissionKeys.join(',')}
      </span>
      <span>
        loading:
        {String(context.isLoadingWorkspacePermissionKeys)}
      </span>
      <span>
        role:
        {context.currentWorkspace.role}
      </span>
    </>
  )
}

describe('AppContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissionKeysState.isPending = false
    mockPermissionKeysState.permissionKeys = ['app.create_and_management']
  })

  describe('Workspace Permission Keys', () => {
    it('should provide current workspace permission keys from my-permissions', () => {
      render(
        <AppContextProvider>
          <AppContextProbe />
        </AppContextProvider>,
      )

      expect(screen.getByText('keys:app.create_and_management')).toBeInTheDocument()
      expect(screen.getByText('loading:false')).toBeInTheDocument()
      expect(screen.getByText('role:editor')).toBeInTheDocument()
    })
  })
})
