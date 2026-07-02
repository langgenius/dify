import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import {
  useSetStepByStepTourAccountState,
  useStepByStepTourAccountStateValue,
  useStepByStepTourStateActions,
} from '../storage'

const stepByStepTourStateQueryKey = ['console', 'onboarding', 'step-by-step-tour', 'state'] as const
let mockStepByStepTourState: StepByStepTourStateResponse

const applyPatchBody = (
  state: StepByStepTourStateResponse,
  body: StepByStepTourStatePatchPayload,
): StepByStepTourStateResponse => {
  switch (body.action) {
    case 'complete_task': {
      if (!body.task_id)
        return state

      return {
        ...state,
        completed_task_ids: state.completed_task_ids?.includes(body.task_id)
          ? state.completed_task_ids
          : [...(state.completed_task_ids ?? []), body.task_id],
      }
    }
    case 'skip':
      return {
        ...state,
        skipped: true,
        manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(id => id !== 'workspace-1'),
      }
    default:
      return state
  }
}

const patchStepByStepTourState = vi.fn(
  async ({ body }: { body: StepByStepTourStatePatchPayload }): Promise<StepByStepTourStateResponse> => {
    mockStepByStepTourState = applyPatchBody(mockStepByStepTourState, body)
    return mockStepByStepTourState
  },
)

vi.mock('@/config', () => ({
  IS_CLOUD_EDITION: true,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    onboarding: {
      stepByStepTour: {
        state: {
          get: {
            queryKey: () => stepByStepTourStateQueryKey,
            queryOptions: () => ({
              queryKey: stepByStepTourStateQueryKey,
              queryFn: async () => mockStepByStepTourState,
            }),
          },
          patch: {
            mutationOptions: () => ({
              mutationFn: patchStepByStepTourState,
            }),
          },
        },
      },
    },
  },
}))

const createStepByStepTourState = (
  overrides: Partial<StepByStepTourStateResponse> = {},
): StepByStepTourStateResponse => ({
  eligible: true,
  first_workspace_id: 'workspace-1',
  skipped: false,
  completed_task_ids: [],
  manually_enabled_workspace_ids: [],
  manually_disabled_workspace_ids: [],
  updated_at: '2026-07-01T00:00:00Z',
  ...overrides,
})

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: {
      retry: false,
      staleTime: Infinity,
    },
  },
})

describe('step-by-step tour storage', () => {
  let queryClient: QueryClient
  let jotaiStore: ReturnType<typeof createStore>

  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={jotaiStore}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </JotaiProvider>
  )

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockStepByStepTourState = createStepByStepTourState()
    queryClient = createTestQueryClient()
    jotaiStore = createStore()
    queryClient.setQueryData(stepByStepTourStateQueryKey, mockStepByStepTourState)
  })

  it('combines backend persistent state with Jotai UI state', () => {
    queryClient.setQueryData(stepByStepTourStateQueryKey, createStepByStepTourState({
      completed_task_ids: ['studio'],
      manually_enabled_workspace_ids: ['workspace-2'],
    }))

    const { result } = renderHook(() => {
      // eslint-disable-next-line react/use-state -- Step-by-step tour state hooks are not React useState calls.
      const updateTourState = useSetStepByStepTourAccountState()
      // eslint-disable-next-line react/use-state -- Step-by-step tour state hooks are not React useState calls.
      const value = useStepByStepTourAccountStateValue()

      return { updateTourState, value }
    }, { wrapper })

    act(() => {
      result.current.updateTourState({
        ...result.current.value,
        activeGuideIndex: 1,
        activeTaskId: 'studio',
        completedTaskIds: ['home'],
        minimized: true,
      })
    })

    expect(result.current.value.completedTaskIds).toEqual(['studio'])
    expect(result.current.value.manuallyEnabledWorkspaceIds).toEqual(['workspace-2'])
    expect(result.current.value.activeTaskId).toBe('studio')
    expect(result.current.value.activeGuideIndex).toBe(1)
    expect(result.current.value.minimized).toBe(true)
  })

  it('ignores legacy localStorage tour UI state', () => {
    localStorage.setItem('step-by-step-tour-ui-state', JSON.stringify({
      activeGuideIndex: 1,
      activeTaskId: 'studio',
      minimized: true,
    }))

    // eslint-disable-next-line react/use-state -- Step-by-step tour storage hooks are not React useState calls.
    const { result } = renderHook(() => useStepByStepTourAccountStateValue(), { wrapper })

    expect(result.current.activeTaskId).toBeUndefined()
    expect(result.current.activeGuideIndex).toBeUndefined()
    expect(result.current.minimized).toBe(false)
  })

  it('persists task completion through the backend patch action', async () => {
    // eslint-disable-next-line react/use-state -- Step-by-step tour state actions are not React useState calls.
    const { result } = renderHook(() => useStepByStepTourStateActions(), { wrapper })

    act(() => {
      result.current.completeTask('home')
    })

    await waitFor(() => {
      expect(patchStepByStepTourState).toHaveBeenCalled()
    })
    expect(patchStepByStepTourState.mock.calls[0]?.[0]).toEqual({
      body: {
        action: 'complete_task',
        task_id: 'home',
      },
    })
    expect(queryClient.getQueryData<StepByStepTourStateResponse>(stepByStepTourStateQueryKey)?.completed_task_ids)
      .toEqual(['home'])
    expect(localStorage.getItem('step-by-step-tour-ui-state')).toBeNull()
  })

  it('persists skip through the backend patch action without storing account state locally', async () => {
    mockStepByStepTourState = createStepByStepTourState({
      manually_enabled_workspace_ids: ['workspace-1', 'workspace-2'],
    })
    queryClient.setQueryData(stepByStepTourStateQueryKey, mockStepByStepTourState)
    // eslint-disable-next-line react/use-state -- Step-by-step tour state actions are not React useState calls.
    const { result } = renderHook(() => useStepByStepTourStateActions(), { wrapper })

    act(() => {
      result.current.skipTour('workspace-1')
    })

    await waitFor(() => {
      expect(patchStepByStepTourState).toHaveBeenCalled()
    })
    expect(patchStepByStepTourState.mock.calls[0]?.[0]).toEqual({
      body: {
        action: 'skip',
      },
    })
    expect(queryClient.getQueryData<StepByStepTourStateResponse>(stepByStepTourStateQueryKey))
      .toMatchObject({
        manually_enabled_workspace_ids: ['workspace-2'],
        skipped: true,
      })
    expect(localStorage.getItem('step-by-step-tour-ui-state')).toBeNull()
  })
})
