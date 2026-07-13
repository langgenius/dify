import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { ZENDESK_FIELD_IDS } from '@/config'
import { zendeskConversationSyncAtom } from '../zendesk-conversation-sync'

type ProfileQueryData = {
  profile: GetAccountProfileResponse
  meta: {
    currentVersion: string | null
    currentEnv: string | null
  }
}

const profileQueryState = vi.hoisted(() => {
  const state = {
    resolve: (_value: unknown) => {},
    queryFn: () =>
      new Promise<unknown>((resolve) => {
        state.resolve = resolve
      }),
  }
  return state
})

const mockCurrentWorkspaceQueryState = vi.hoisted(() => ({
  isPending: true,
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
  },
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

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['user-profile'],
    queryFn: profileQueryState.queryFn,
  }),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
    queryFn: async () => mockSystemFeaturesState.data,
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
              if (mockCurrentWorkspaceQueryState.isPending) return new Promise(() => {})

              return mockCurrentWorkspaceResponse
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

vi.mock('@/app/components/base/zendesk/utils', () => ({
  setZendeskConversationFields: vi.fn(),
}))

function createProfileQueryData(): ProfileQueryData {
  return {
    profile: {
      id: 'user-1',
      name: 'User',
      email: 'user@example.com',
      avatar: '',
      avatar_url: '',
      is_password_set: true,
    } as GetAccountProfileResponse,
    meta: {
      currentVersion: '1.0.0',
      currentEnv: 'cloud',
    },
  }
}

function createTestStore() {
  const store = createStore()
  store.set(
    queryClientAtom,
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    }),
  )
  return store
}

async function flushMicrotasks() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

// Regression for langgenius/dify#38840: the effect used to read
// resolved-suspense atoms (profile directly, and meta/system-features via
// langGeniusVersionInfoAtom), which throw while their queries are pending.
describe('zendeskConversationSyncAtom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentWorkspaceQueryState.isPending = true
  })

  describe('cold caches', () => {
    it('should not throw and should skip all field syncs while queries are pending', async () => {
      const store = createTestStore()

      expect(() => store.sub(zendeskConversationSyncAtom, () => {})).not.toThrow()
      await flushMicrotasks()

      expect(setZendeskConversationFields).not.toHaveBeenCalled()
    })

    it('should sync all fields when the pending queries resolve', async () => {
      mockCurrentWorkspaceQueryState.isPending = false
      const store = createTestStore()
      store.sub(zendeskConversationSyncAtom, () => {})
      await flushMicrotasks()

      profileQueryState.resolve(createProfileQueryData())

      await vi.waitFor(() => {
        expect(setZendeskConversationFields).toHaveBeenCalledWith([
          {
            id: ZENDESK_FIELD_IDS.EMAIL,
            value: 'user@example.com',
          },
        ])
      })
      await vi.waitFor(() => {
        expect(setZendeskConversationFields).toHaveBeenCalledWith([
          {
            id: ZENDESK_FIELD_IDS.ENVIRONMENT,
            value: 'cloud',
          },
        ])
      })
      await vi.waitFor(() => {
        expect(setZendeskConversationFields).toHaveBeenCalledWith([
          {
            id: ZENDESK_FIELD_IDS.VERSION,
            value: '1.0.1',
          },
        ])
      })
      await vi.waitFor(() => {
        expect(setZendeskConversationFields).toHaveBeenCalledWith([
          {
            id: ZENDESK_FIELD_IDS.WORKSPACE_ID,
            value: 'workspace-1',
          },
        ])
      })
    })
  })
})
