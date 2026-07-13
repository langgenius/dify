import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { amplitudeIdentitySyncAtom } from '../amplitude-identity-sync'

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

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['user-profile'],
    queryFn: profileQueryState.queryFn,
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
            queryFn: async () => mockCurrentWorkspaceResponse,
            ...options,
          }),
        },
      },
    },
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  setUserId: vi.fn(),
  setUserProperties: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude/registration-tracking', () => ({
  flushRegistrationSuccess: vi.fn(),
}))

function createProfileQueryData(
  overrides: Partial<GetAccountProfileResponse> = {},
): ProfileQueryData {
  return {
    profile: {
      id: 'user-1',
      name: 'User',
      email: 'user@example.com',
      avatar: '',
      avatar_url: '',
      is_password_set: true,
      ...overrides,
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

async function flushAsync() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

// Regression for langgenius/dify#38840: reading a resolved-suspense atom throws while pending.
describe('amplitudeIdentitySyncAtom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('cold profile cache', () => {
    it('should not throw and should skip sync while the profile query is pending', async () => {
      const store = createTestStore()

      expect(() => store.sub(amplitudeIdentitySyncAtom, () => {})).not.toThrow()
      await flushAsync()

      expect(setUserId).not.toHaveBeenCalled()
      expect(setUserProperties).not.toHaveBeenCalled()
      expect(flushRegistrationSuccess).not.toHaveBeenCalled()
    })

    it('should sync identity when the pending profile query resolves', async () => {
      const store = createTestStore()
      store.sub(amplitudeIdentitySyncAtom, () => {})
      await flushAsync()

      profileQueryState.resolve(createProfileQueryData())

      await vi.waitFor(() => {
        expect(setUserId).toHaveBeenCalledWith('user@example.com')
      })
      expect(setUserProperties).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          workspace_id: 'workspace-1',
          workspace_role: 'editor',
        }),
      )
      expect(flushRegistrationSuccess).toHaveBeenCalledTimes(1)
    })

    it('should skip sync when the resolved profile has no id', async () => {
      const store = createTestStore()
      store.sub(amplitudeIdentitySyncAtom, () => {})
      await flushAsync()

      profileQueryState.resolve(createProfileQueryData({ id: '', email: '', name: '' }))
      await flushAsync()

      expect(setUserId).not.toHaveBeenCalled()
      expect(setUserProperties).not.toHaveBeenCalled()
    })
  })

  describe('warm profile cache', () => {
    it('should sync identity when the profile query is already cached', async () => {
      const store = createStore()
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: Number.POSITIVE_INFINITY,
          },
        },
      })
      queryClient.setQueryData(['user-profile'], createProfileQueryData())
      store.set(queryClientAtom, queryClient)

      store.sub(amplitudeIdentitySyncAtom, () => {})

      await vi.waitFor(() => {
        expect(setUserId).toHaveBeenCalledWith('user@example.com')
      })
    })

    it('should not re-sync identity when the effect re-runs with the same profile', async () => {
      const store = createStore()
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: Number.POSITIVE_INFINITY,
          },
        },
      })
      queryClient.setQueryData(['user-profile'], createProfileQueryData())
      queryClient.setQueryData(['current-workspace'], mockCurrentWorkspaceResponse)
      store.set(queryClientAtom, queryClient)

      store.sub(amplitudeIdentitySyncAtom, () => {})
      await vi.waitFor(() => {
        expect(setUserProperties).toHaveBeenCalledWith(
          expect.objectContaining({ workspace_id: 'workspace-1' }),
        )
      })
      await flushAsync()
      const settledCallCount = vi.mocked(setUserId).mock.calls.length

      queryClient.setQueryData(
        ['user-profile'],
        createProfileQueryData({ avatar: 'changed-avatar' }),
      )
      await flushAsync()

      expect(setUserId).toHaveBeenCalledTimes(settledCallCount)
      expect(setUserProperties).toHaveBeenCalledTimes(settledCallCount)
    })
  })
})
