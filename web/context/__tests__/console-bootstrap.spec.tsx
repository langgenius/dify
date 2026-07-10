import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider as JotaiProvider, useAtomValue, useSetAtom } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/react/utils'
import { Suspense } from 'react'
import { ExternalServiceSync } from '@/app/(commonLayout)/external-service-sync'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { ZENDESK_FIELD_IDS } from '@/config'
import { refreshUserProfileAtom, userProfileAtom } from '../account-state'
import { initialWorkspaceInfo } from '../app-context-defaults'
import { workspacePermissionKeysAtom, workspacePermissionKeysLoadingAtom } from '../permission-state'
import { langGeniusVersionInfoAtom } from '../version-state'
import {
  currentWorkspaceAtom,
  currentWorkspaceLoadingAtom,
  isCurrentWorkspaceDatasetOperatorAtom,
  isCurrentWorkspaceEditorAtom,
  isCurrentWorkspaceManagerAtom,
  isCurrentWorkspaceOwnerAtom,
  refreshCurrentWorkspaceAtom,
} from '../workspace-state'

const mockGetRequest = vi.hoisted(() => vi.fn())
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
const mockCurrentWorkspaceQueryState = vi.hoisted(() => ({
  data: mockCurrentWorkspaceResponse as typeof mockCurrentWorkspaceResponse | undefined,
  isPending: false,
}))
const mockUserProfileResponseState = vi.hoisted(() => ({
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
  } as {
    profile: {
      id: string
      name: string
      email: string
      avatar: string
      avatar_url: string
      is_password_set: boolean
    }
    meta: {
      currentVersion: string | null
      currentEnv: string | null
    }
  },
}))
const mockSystemFeaturesState = vi.hoisted(() => ({
  data: {
    branding: {
      enabled: false,
    },
  },
}))
const mockLangGeniusVersionState = vi.hoisted(() => ({
  data: {
    version: '1.0.1',
    release_date: '',
    release_notes: '',
    features: {
      can_replace_logo: false,
      model_load_balancing_enabled: false,
    },
    can_auto_update: false,
  } as {
    version: string
    release_date: string
    release_notes: string
    features: {
      can_replace_logo: boolean
      model_load_balancing_enabled: boolean
    }
    can_auto_update: boolean
  } | undefined,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    ZENDESK_FIELD_IDS: {
      ENVIRONMENT: 'environment-field',
      VERSION: 'version-field',
      EMAIL: 'email-field',
      WORKSPACE_ID: 'workspace-id-field',
    },
  }
})

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
    queryFn: async () => mockSystemFeaturesState.data,
  }),
}))

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['user-profile'],
    queryFn: async () => mockUserProfileResponseState.data,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        post: {
          key: () => ['current-workspace'],
          queryOptions: (options: {
            select?: (workspace?: typeof mockCurrentWorkspaceResponse) => unknown
          }) => ({
            queryKey: ['current-workspace'],
            queryFn: async () => {
              if (mockCurrentWorkspaceQueryState.isPending)
                return new Promise(() => {})

              return mockCurrentWorkspaceQueryState.data
            },
            ...options,
          }),
        },
      },
    },
    version: {
      get: {
        queryOptions: (options: {
          enabled?: boolean
          input?: {
            query: {
              current_version: string
            }
          }
        }) => ({
          queryKey: ['version', options.input?.query.current_version],
          queryFn: async () => mockLangGeniusVersionState.data,
          ...options,
        }),
      },
    },
  },
}))

vi.mock('@/service/base', () => ({
  get: mockGetRequest,
  post: vi.fn(),
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

function ConsoleBootstrapProbe() {
  const userProfile = useAtomValue(userProfileAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const isCurrentWorkspaceEditor = useAtomValue(isCurrentWorkspaceEditorAtom)
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isLoadingWorkspacePermissionKeys = useAtomValue(workspacePermissionKeysLoadingAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const langGeniusVersionInfo = useAtomValue(langGeniusVersionInfoAtom)
  const refreshUserProfile = useSetAtom(refreshUserProfileAtom)
  const refreshCurrentWorkspace = useSetAtom(refreshCurrentWorkspaceAtom)

  return (
    <>
      <span>
        keys:
        {workspacePermissionKeys.join(',')}
      </span>
      <span>
        permission loading:
        {String(isLoadingWorkspacePermissionKeys)}
      </span>
      <span>
        workspace loading:
        {String(isLoadingCurrentWorkspace)}
      </span>
      <span>
        user:
        {userProfile.email}
      </span>
      <span>
        workspace:
        {currentWorkspace.name}
      </span>
      <span>
        role:
        {currentWorkspace.role}
      </span>
      <span>
        manager:
        {String(isCurrentWorkspaceManager)}
      </span>
      <span>
        owner:
        {String(isCurrentWorkspaceOwner)}
      </span>
      <span>
        editor:
        {String(isCurrentWorkspaceEditor)}
      </span>
      <span>
        dataset operator:
        {String(isCurrentWorkspaceDatasetOperator)}
      </span>
      <span>
        version:
        {langGeniusVersionInfo.current_version}
        /
        {langGeniusVersionInfo.latest_version}
        /
        {langGeniusVersionInfo.current_env}
      </span>
      <button type="button" onClick={refreshUserProfile}>refresh user</button>
      <button type="button" onClick={refreshCurrentWorkspace}>refresh workspace</button>
    </>
  )
}

function TestQueryClientHydrator({
  children,
  queryClient,
}: {
  children: ReactNode
  queryClient: QueryClient
}) {
  useHydrateAtoms(new Map([[queryClientAtom, queryClient]]))

  return children
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  })
}

function renderConsoleBootstrap() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['user-profile'], mockUserProfileResponseState.data)
  queryClient.setQueryData(['system-features'], mockSystemFeaturesState.data)

  const view = render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <TestQueryClientHydrator queryClient={queryClient}>
          <Suspense fallback={<span>loading</span>}>
            <ExternalServiceSync />
            <ConsoleBootstrapProbe />
          </Suspense>
        </TestQueryClientHydrator>
      </QueryClientProvider>
    </JotaiProvider>,
  )

  return {
    ...view,
    queryClient,
  }
}

describe('Console bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissionKeysState.isPending = false
    mockPermissionKeysState.permissionKeys = ['app.create_and_management']
    mockCurrentWorkspaceQueryState.data = mockCurrentWorkspaceResponse
    mockCurrentWorkspaceQueryState.isPending = false
    mockUserProfileResponseState.data = {
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
    }
    mockSystemFeaturesState.data = {
      branding: {
        enabled: false,
      },
    }
    mockLangGeniusVersionState.data = {
      version: '1.0.1',
      release_date: '',
      release_notes: '',
      features: {
        can_replace_logo: false,
        model_load_balancing_enabled: false,
      },
      can_auto_update: false,
    }
    mockGetRequest.mockImplementation((url: string) => {
      if (url === '/workspaces/current/rbac/my-permissions') {
        if (mockPermissionKeysState.isPending)
          return new Promise(() => {})

        return Promise.resolve({
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
        })
      }

      if (url === '/version')
        return Promise.resolve(mockLangGeniusVersionState.data)

      return Promise.reject(new Error(`Unexpected GET ${url}`))
    })
  })

  describe('Bootstrap atoms', () => {
    it('should provide profile, workspace, permissions, loading state, and version metadata', async () => {
      renderConsoleBootstrap()

      expect(await screen.findByText('user:user@example.com')).toBeInTheDocument()
      expect(await screen.findByText('workspace:Workspace')).toBeInTheDocument()
      expect(await screen.findByText('keys:app.create_and_management')).toBeInTheDocument()
      expect(screen.getByText('permission loading:false')).toBeInTheDocument()
      expect(screen.getByText('workspace loading:false')).toBeInTheDocument()
      expect(await screen.findByText('version:1.0.0/1.0.1/cloud')).toBeInTheDocument()
    })

    it('should fall back to placeholder values when workspace, permission, or version data is missing', async () => {
      mockCurrentWorkspaceQueryState.data = undefined
      mockPermissionKeysState.permissionKeys = []
      mockLangGeniusVersionState.data = undefined

      renderConsoleBootstrap()

      expect(await screen.findByText('user:user@example.com')).toBeInTheDocument()
      expect(screen.getByText(`workspace:${initialWorkspaceInfo.name}`)).toBeInTheDocument()
      expect(screen.getByText(`role:${initialWorkspaceInfo.role}`)).toBeInTheDocument()
      expect(screen.getByText('keys:')).toBeInTheDocument()
      expect(screen.getByText('version://')).toBeInTheDocument()
    })

    it('should normalize invalid workspace roles to the initial workspace role', async () => {
      mockCurrentWorkspaceQueryState.data = {
        ...mockCurrentWorkspaceResponse,
        role: 'unsupported-role',
      }

      renderConsoleBootstrap()

      expect(await screen.findByText(`role:${initialWorkspaceInfo.role}`)).toBeInTheDocument()
    })

    it('should derive role flags from the current workspace role', async () => {
      mockCurrentWorkspaceQueryState.data = {
        ...mockCurrentWorkspaceResponse,
        role: 'owner',
      }

      renderConsoleBootstrap()

      expect(await screen.findByText('manager:true')).toBeInTheDocument()
      expect(screen.getByText('owner:true')).toBeInTheDocument()
      expect(screen.getByText('editor:true')).toBeInTheDocument()
      expect(screen.getByText('dataset operator:false')).toBeInTheDocument()
    })

    it('should expose query loading state', async () => {
      mockPermissionKeysState.isPending = true
      mockCurrentWorkspaceQueryState.isPending = true

      renderConsoleBootstrap()

      expect(await screen.findByText('workspace loading:true')).toBeInTheDocument()
      expect(screen.getByText('permission loading:true')).toBeInTheDocument()
    })
  })

  describe('Refresh actions', () => {
    it('should invalidate the source queries when refresh actions are called', async () => {
      const { queryClient } = renderConsoleBootstrap()
      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      fireEvent.click(await screen.findByRole('button', { name: /refresh user/i }))
      fireEvent.click(screen.getByRole('button', { name: /refresh workspace/i }))

      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['user-profile'] })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['current-workspace'] })
    })
  })

  describe('External side effects', () => {
    it('should sync Zendesk fields and Amplitude identity when bootstrap data is available', async () => {
      renderConsoleBootstrap()

      await waitFor(() => {
        expect(setZendeskConversationFields).toHaveBeenCalledWith([{
          id: ZENDESK_FIELD_IDS.ENVIRONMENT,
          value: 'cloud',
        }])
      })
      expect(setZendeskConversationFields).toHaveBeenCalledWith([{
        id: ZENDESK_FIELD_IDS.VERSION,
        value: '1.0.1',
      }])
      expect(setZendeskConversationFields).toHaveBeenCalledWith([{
        id: ZENDESK_FIELD_IDS.EMAIL,
        value: 'user@example.com',
      }])
      await waitFor(() => {
        expect(setZendeskConversationFields).toHaveBeenCalledWith([{
          id: ZENDESK_FIELD_IDS.WORKSPACE_ID,
          value: 'workspace-1',
        }])
      })
      await waitFor(() => {
        expect(setUserId).toHaveBeenCalledWith('user@example.com')
        expect(setUserProperties).toHaveBeenCalledWith(expect.objectContaining({
          email: 'user@example.com',
          workspace_id: 'workspace-1',
          workspace_role: 'editor',
        }))
        expect(flushRegistrationSuccess).toHaveBeenCalled()
      })
    })

    it('should not sync Amplitude identity when user id is missing', async () => {
      mockUserProfileResponseState.data = {
        profile: {
          id: '',
          name: '',
          email: '',
          avatar: '',
          avatar_url: '',
          is_password_set: false,
        },
        meta: {
          currentVersion: '1.0.0',
          currentEnv: 'cloud',
        },
      }

      renderConsoleBootstrap()

      await screen.findByText('user:')
      expect(setUserId).not.toHaveBeenCalled()
      expect(setUserProperties).not.toHaveBeenCalled()
      expect(flushRegistrationSuccess).not.toHaveBeenCalled()
    })
  })
})
