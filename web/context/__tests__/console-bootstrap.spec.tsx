import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactNode } from 'react'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider as JotaiProvider, useAtomValue, useSetAtom } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/react/utils'
import { Suspense } from 'react'
import { ExternalServiceSync } from '@/app/(commonLayout)/external-service-sync'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { setAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { zendeskRuntime } from '@/app/components/base/zendesk/runtime'
import { ZENDESK_FIELD_IDS } from '@/config'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import {
  datasetDefaultPermissionKeysAtom,
  refreshWorkspacePermissionKeysAfterMutationDenialAtom,
  workspacePermissionKeysAtom,
  workspacePermissionKeysLoadingAtom,
} from '../permission-state'
import {
  currentWorkspaceAtom,
  currentWorkspaceLoadingAtom,
  isCurrentWorkspaceDatasetOperatorAtom,
  isCurrentWorkspaceManagerAtom,
  isCurrentWorkspaceOwnerAtom,
} from '../workspace-state'

const mockRequest = vi.hoisted(() => vi.fn())
const mockGetPermissionKeys = vi.hoisted(() => vi.fn())
const mockPermissionKeysState = vi.hoisted(() => ({
  datasetPermissionKeys: ['dataset.acl.edit'],
  isPending: false,
  permissionKeys: ['app.create_and_management'],
}))
const mockCurrentWorkspaceResponse = vi.hoisted(() => ({
  id: 'workspace-1',
  name: 'Workspace',
  plan: 'sandbox',
  credits: 200,
  role: 'editor',
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
  data: null as unknown as GetSystemFeaturesResponse,
}))
const mockLangGeniusVersionState = vi.hoisted(() => ({
  data: {
    version: '1.0.1',
    release_notes: '',
  } as
    | {
        version: string
        release_notes: string
      }
    | undefined,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    ZENDESK_FIELD_IDS: {
      PLAN: '',
      ENVIRONMENT: 'environment-field',
      VERSION: 'version-field',
      EMAIL: 'email-field',
      WORKSPACE_ID: 'workspace-id-field',
    },
  }
})

vi.mock('@/service/base', () => ({ request: mockRequest }))

vi.mock('@/app/components/base/amplitude', () => ({
  setUserId: vi.fn(),
  setUserProperties: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude/use-amplitude-initialized', () => ({
  useAmplitudeInitialized: () => true,
}))

vi.mock('@/app/components/base/amplitude/registration-tracking', () => ({
  flushRegistrationSuccess: vi.fn(),
  subscribeRegistrationSuccess: () => () => {},
  getRegistrationSuccessSnapshot: () => 0,
}))

vi.mock('@/app/components/base/zendesk/runtime', () => ({
  zendeskRuntime: {
    setConversationFields: vi.fn(),
  },
}))

function ConsoleBootstrapProbe() {
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const isLoadingWorkspacePermissionKeys = useAtomValue(workspacePermissionKeysLoadingAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const refreshPermissionsAfterMutationDenial = useSetAtom(
    refreshWorkspacePermissionKeysAfterMutationDenialAtom,
  )

  return (
    <>
      <span>
        keys:
        {workspacePermissionKeys.join(',')}
      </span>
      <span>
        dataset keys:
        {datasetDefaultPermissionKeys.join(',')}
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
        dataset operator:
        {String(isCurrentWorkspaceDatasetOperator)}
      </span>
      <button type="button" onClick={() => void refreshPermissionsAfterMutationDenial()}>
        refresh permissions after denial
      </button>
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

function createConsoleQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  })
}

function renderConsoleBootstrap() {
  const queryClient = createConsoleQueryClient()
  seedAccountProfileQuery(
    queryClient,
    mockUserProfileResponseState.data.profile,
    mockUserProfileResponseState.data.meta,
  )
  queryClient.setQueryData(consoleQuery.systemFeatures.get.queryKey(), mockSystemFeaturesState.data)

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
    setAnalyticsConsent('granted')
    mockPermissionKeysState.isPending = false
    mockPermissionKeysState.datasetPermissionKeys = ['dataset.acl.edit']
    mockPermissionKeysState.permissionKeys = ['app.create_and_management']
    mockGetPermissionKeys.mockImplementation(async () => {
      if (mockPermissionKeysState.isPending) return new Promise(() => {})

      return {
        workspace: {
          permission_keys: mockPermissionKeysState.permissionKeys,
        },
        app: {
          default_permission_keys: [],
          overrides: [],
        },
        dataset: {
          default_permission_keys: mockPermissionKeysState.datasetPermissionKeys,
          overrides: [],
        },
      }
    })
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
    mockSystemFeaturesState.data = createSystemFeaturesFixture({
      deployment_edition: 'CLOUD',
    })
    mockLangGeniusVersionState.data = {
      version: '1.0.1',
      release_notes: '',
    }
    mockRequest.mockImplementation(
      async (_url: string, _init: RequestInit, { request }: { request: Request }) => {
        const path = new URL(request.url).pathname
        if (path.endsWith('/workspaces/current/summary')) {
          if (mockCurrentWorkspaceQueryState.isPending) return new Promise(() => {})
          return Response.json(mockCurrentWorkspaceQueryState.data)
        }
        if (path.includes('/rbac/')) return Response.json(await mockGetPermissionKeys())
        if (path.endsWith('/version')) return Response.json(mockLangGeniusVersionState.data)
        if (path.endsWith('/features')) return new Promise(() => {})
        throw new Error(`Unexpected request: ${request.method} ${path}`)
      },
    )
  })

  describe('Bootstrap atoms', () => {
    it('should provide workspace, permissions, and loading state', async () => {
      renderConsoleBootstrap()

      expect(await screen.findByText('workspace:Workspace')).toBeInTheDocument()
      expect(await screen.findByText('keys:app.create_and_management')).toBeInTheDocument()
      expect(screen.getByText('dataset keys:dataset.acl.edit')).toBeInTheDocument()
      expect(screen.getByText('permission loading:false')).toBeInTheDocument()
      expect(screen.getByText('workspace loading:false')).toBeInTheDocument()
    })

    it('should derive role flags from the current workspace role', async () => {
      mockCurrentWorkspaceQueryState.data = {
        ...mockCurrentWorkspaceResponse,
        role: 'owner',
      }

      renderConsoleBootstrap()

      expect(await screen.findByText('manager:true')).toBeInTheDocument()
      expect(screen.getByText('owner:true')).toBeInTheDocument()
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
    it('starts a fresh permission request without waiting for an older request', async () => {
      const user = userEvent.setup()
      const { queryClient } = renderConsoleBootstrap()
      await screen.findByText('dataset keys:dataset.acl.edit')
      const olderRequest = new Promise(() => {})
      let permissionRequestCount = 0
      mockGetPermissionKeys.mockImplementation(() => {
        permissionRequestCount += 1
        if (permissionRequestCount === 1) return olderRequest
        return Promise.resolve({
          workspace: { permission_keys: [] },
          app: { default_permission_keys: [], overrides: [] },
          dataset: { default_permission_keys: ['dataset.acl.readonly'], overrides: [] },
        })
      })

      const backgroundRefresh = queryClient.refetchQueries({
        queryKey: consoleQuery.workspaces.current.rbac.myPermissions.get.queryKey(),
      })
      await waitFor(() => expect(permissionRequestCount).toBe(1))
      await user.click(screen.getByRole('button', { name: /refresh permissions after denial/i }))
      await waitFor(() => expect(permissionRequestCount).toBe(2))
      expect(await screen.findByText('dataset keys:dataset.acl.readonly')).toBeInTheDocument()
      await backgroundRefresh
    })
  })

  describe('External side effects', () => {
    it('should sync Zendesk fields and Amplitude identity when bootstrap data is available', async () => {
      renderConsoleBootstrap()

      await waitFor(() => {
        expect(zendeskRuntime.setConversationFields).toHaveBeenCalledWith(
          [
            {
              id: ZENDESK_FIELD_IDS.ENVIRONMENT,
              value: 'cloud',
            },
          ],
          'CLOUD',
        )
      })
      expect(zendeskRuntime.setConversationFields).toHaveBeenCalledWith(
        [
          {
            id: ZENDESK_FIELD_IDS.VERSION,
            value: '1.0.1',
          },
        ],
        'CLOUD',
      )
      expect(zendeskRuntime.setConversationFields).toHaveBeenCalledWith(
        [
          {
            id: ZENDESK_FIELD_IDS.EMAIL,
            value: 'user@example.com',
          },
        ],
        'CLOUD',
      )
      await waitFor(() => {
        expect(zendeskRuntime.setConversationFields).toHaveBeenCalledWith(
          [
            {
              id: ZENDESK_FIELD_IDS.WORKSPACE_ID,
              value: 'workspace-1',
            },
          ],
          'CLOUD',
        )
      })
      await waitFor(() => {
        expect(setUserId).toHaveBeenCalledWith('user@example.com')
        const properties = vi.mocked(setUserProperties).mock.calls.at(-1)?.[0]
        expect(properties).toEqual(
          expect.objectContaining({
            email: 'user@example.com',
            workspace_id: 'workspace-1',
            workspace_plan: 'sandbox',
            workspace_role: 'editor',
          }),
        )
        expect(properties).not.toHaveProperty('workspace_status')
        expect(flushRegistrationSuccess).toHaveBeenCalled()
      })
    })

    it('syncs the actual plan only after features arrive and follows plan changes', async () => {
      ZENDESK_FIELD_IDS.PLAN = 'plan-field'
      try {
        const { queryClient } = renderConsoleBootstrap()
        await waitFor(() => expect(zendeskRuntime.setConversationFields).toHaveBeenCalled())
        expect(
          vi
            .mocked(zendeskRuntime.setConversationFields)
            .mock.calls.flatMap(([fields]) => fields)
            .some((field) => field.id === 'plan-field'),
        ).toBe(false)
        act(() =>
          queryClient.setQueryData(
            consoleQuery.features.get.queryKey(),
            zGetFeaturesResponse.parse({
              billing: { subscription: { plan: 'professional', interval: 'month' } },
            }),
          ),
        )
        await waitFor(() =>
          expect(zendeskRuntime.setConversationFields).toHaveBeenCalledWith(
            [{ id: 'plan-field', value: 'professional-plan' }],
            'CLOUD',
          ),
        )
        act(() =>
          queryClient.setQueryData(
            consoleQuery.features.get.queryKey(),
            zGetFeaturesResponse.parse({
              billing: { subscription: { plan: 'team', interval: 'month' } },
            }),
          ),
        )
        await waitFor(() =>
          expect(zendeskRuntime.setConversationFields).toHaveBeenCalledWith(
            [{ id: 'plan-field', value: 'team-plan' }],
            'CLOUD',
          ),
        )
      } finally {
        ZENDESK_FIELD_IDS.PLAN = ''
      }
    })

    it('should not sync Zendesk fields outside cloud deployments', async () => {
      mockSystemFeaturesState.data = createSystemFeaturesFixture({
        deployment_edition: 'COMMUNITY',
      })

      renderConsoleBootstrap()

      await screen.findByText('workspace:Workspace')
      expect(zendeskRuntime.setConversationFields).not.toHaveBeenCalled()
    })

    it('should resync only changed Zendesk fields', async () => {
      const { queryClient, rerender } = renderConsoleBootstrap()

      await screen.findByText('workspace:Workspace')
      await waitFor(() =>
        expect(zendeskRuntime.setConversationFields).toHaveBeenCalledWith(
          [{ id: ZENDESK_FIELD_IDS.VERSION, value: '1.0.1' }],
          'CLOUD',
        ),
      )
      vi.mocked(zendeskRuntime.setConversationFields).mockClear()

      rerender(
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
      expect(zendeskRuntime.setConversationFields).not.toHaveBeenCalled()

      act(() => {
        queryClient.setQueryData(userProfileQueryOptions().queryKey, {
          ...mockUserProfileResponseState.data,
          profile: {
            ...mockUserProfileResponseState.data.profile,
            email: 'updated@example.com',
          },
        })
      })

      await waitFor(() => {
        expect(zendeskRuntime.setConversationFields).toHaveBeenCalledOnce()
        expect(zendeskRuntime.setConversationFields).toHaveBeenLastCalledWith(
          [
            {
              id: ZENDESK_FIELD_IDS.EMAIL,
              value: 'updated@example.com',
            },
          ],
          'CLOUD',
        )
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

      await screen.findByText('workspace:Workspace')
      expect(setUserId).not.toHaveBeenCalled()
      expect(setUserProperties).not.toHaveBeenCalled()
      expect(flushRegistrationSuccess).not.toHaveBeenCalled()
    })

    it('should sync an already loaded identity after analytics consent is granted', async () => {
      setAnalyticsConsent('denied')
      renderConsoleBootstrap()

      await screen.findByText('workspace:Workspace')
      expect(setUserId).not.toHaveBeenCalled()
      expect(setUserProperties).not.toHaveBeenCalled()

      act(() => setAnalyticsConsent('granted'))

      await waitFor(() => {
        expect(setUserId).toHaveBeenCalledWith('user@example.com')
        expect(setUserProperties).toHaveBeenCalled()
        expect(flushRegistrationSuccess).toHaveBeenCalled()
      })
    })

    it('should resync Amplitude only when identity properties change', async () => {
      const { queryClient, rerender } = renderConsoleBootstrap()

      await waitFor(() =>
        expect(setUserProperties).toHaveBeenCalledWith(
          expect.objectContaining({ workspace_id: 'workspace-1' }),
        ),
      )
      vi.mocked(setUserProperties).mockClear()

      rerender(
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
      expect(setUserProperties).not.toHaveBeenCalled()

      act(() => {
        queryClient.setQueryData(userProfileQueryOptions().queryKey, {
          ...mockUserProfileResponseState.data,
          profile: {
            ...mockUserProfileResponseState.data.profile,
            name: 'Updated User',
          },
        })
      })

      await waitFor(() => {
        expect(setUserProperties).toHaveBeenCalledOnce()
        expect(setUserProperties).toHaveBeenLastCalledWith(
          expect.objectContaining({ name: 'Updated User' }),
        )
      })
    })
  })
})
