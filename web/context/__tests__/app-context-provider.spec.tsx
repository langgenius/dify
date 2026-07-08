import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/react/utils'
import { Suspense } from 'react'
import { useContext } from 'use-context-selector'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { ZENDESK_FIELD_IDS } from '@/config'
import { AppContext, initialWorkspaceInfo, useSelector } from '../app-context'
import { AppContextProvider } from '../app-context-provider'

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
    profile?: {
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
    can_auto_update: false,
  } as {
    version: string
    release_date: string
    release_notes: string
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

function AppContextProbe() {
  const context = useContext(AppContext)
  const selectedWorkspacePermissionKeys = useSelector(state => state.workspacePermissionKeys)

  return (
    <>
      <span>
        keys:
        {selectedWorkspacePermissionKeys.join(',')}
      </span>
      <span>
        permission loading:
        {String(context.isLoadingWorkspacePermissionKeys)}
      </span>
      <span>
        workspace loading:
        {String(context.isLoadingCurrentWorkspace)}
      </span>
      <span>
        workspace validating:
        {String(context.isValidatingCurrentWorkspace)}
      </span>
      <span>
        user:
        {context.userProfile.email}
      </span>
      <span>
        workspace:
        {context.currentWorkspace.name}
      </span>
      <span>
        role:
        {context.currentWorkspace.role}
      </span>
      <span>
        manager:
        {String(context.isCurrentWorkspaceManager)}
      </span>
      <span>
        owner:
        {String(context.isCurrentWorkspaceOwner)}
      </span>
      <span>
        editor:
        {String(context.isCurrentWorkspaceEditor)}
      </span>
      <span>
        dataset operator:
        {String(context.isCurrentWorkspaceDatasetOperator)}
      </span>
      <span>
        version:
        {context.langGeniusVersionInfo.current_version}
        /
        {context.langGeniusVersionInfo.latest_version}
        /
        {context.langGeniusVersionInfo.current_env}
      </span>
      <button type="button" onClick={context.mutateUserProfile}>refresh user</button>
      <button type="button" onClick={context.mutateCurrentWorkspace}>refresh workspace</button>
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

function renderProvider() {
  const queryClient = createTestQueryClient()
  const view = render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <TestQueryClientHydrator queryClient={queryClient}>
          <Suspense fallback={<span>loading</span>}>
            <AppContextProvider>
              <AppContextProbe />
            </AppContextProvider>
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

describe('AppContextProvider', () => {
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

  describe('Context compatibility values', () => {
    it('should provide profile, workspace, permissions, loading state, and version metadata', async () => {
      renderProvider()

      expect(await screen.findByText('user:user@example.com')).toBeInTheDocument()
      expect(await screen.findByText('workspace:Workspace')).toBeInTheDocument()
      expect(await screen.findByText('keys:app.create_and_management')).toBeInTheDocument()
      expect(screen.getByText('permission loading:false')).toBeInTheDocument()
      expect(screen.getByText('workspace loading:false')).toBeInTheDocument()
      expect(screen.getByText('workspace validating:false')).toBeInTheDocument()
      expect(await screen.findByText('version:1.0.0/1.0.1/cloud')).toBeInTheDocument()
    })

    it('should fall back to placeholder values when profile, workspace, permission, or version data is missing', async () => {
      mockUserProfileResponseState.data = {
        meta: {
          currentVersion: null,
          currentEnv: null,
        },
      }
      mockCurrentWorkspaceQueryState.data = undefined
      mockPermissionKeysState.permissionKeys = []
      mockLangGeniusVersionState.data = undefined

      renderProvider()

      expect(await screen.findByText('user:')).toBeInTheDocument()
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

      renderProvider()

      expect(await screen.findByText(`role:${initialWorkspaceInfo.role}`)).toBeInTheDocument()
    })

    it('should derive role flags from the current workspace role', async () => {
      mockCurrentWorkspaceQueryState.data = {
        ...mockCurrentWorkspaceResponse,
        role: 'owner',
      }

      renderProvider()

      expect(await screen.findByText('manager:true')).toBeInTheDocument()
      expect(screen.getByText('owner:true')).toBeInTheDocument()
      expect(screen.getByText('editor:true')).toBeInTheDocument()
      expect(screen.getByText('dataset operator:false')).toBeInTheDocument()
    })

    it('should expose query loading and validating state', async () => {
      mockPermissionKeysState.isPending = true
      mockCurrentWorkspaceQueryState.isPending = true

      renderProvider()

      expect(await screen.findByText('workspace loading:true')).toBeInTheDocument()
      expect(screen.getByText('workspace validating:true')).toBeInTheDocument()
      expect(screen.getByText('permission loading:true')).toBeInTheDocument()
    })
  })

  describe('Refresh actions', () => {
    it('should invalidate the source queries when refresh actions are called', async () => {
      const { queryClient } = renderProvider()
      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      fireEvent.click(await screen.findByRole('button', { name: /refresh user/i }))
      fireEvent.click(screen.getByRole('button', { name: /refresh workspace/i }))

      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['user-profile'] })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['current-workspace'] })
    })
  })

  describe('External side effects', () => {
    it('should sync Zendesk fields and Amplitude identity when bootstrap data is available', async () => {
      renderProvider()

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

      renderProvider()

      await screen.findByText('user:')
      expect(setUserId).not.toHaveBeenCalled()
      expect(setUserProperties).not.toHaveBeenCalled()
      expect(flushRegistrationSuccess).not.toHaveBeenCalled()
    })
  })
})
