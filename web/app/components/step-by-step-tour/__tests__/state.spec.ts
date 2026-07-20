import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import {
  activeStepByStepTourGuideGroupAtom,
  activeStepByStepTourGuideIndexAtom,
  activeStepByStepTourGuideIndexesAtom,
  activeStepByStepTourTaskIdAtom,
  advanceStepByStepTourGuideAtom,
  completedStepByStepTourTaskIdsAtom,
  completeStepByStepTourTaskAtom,
  disableStepByStepTourForCurrentWorkspaceAtom,
  enableStepByStepTourForCurrentWorkspaceAtom,
  resetStepByStepTourSessionAtom,
  resolveStepByStepTourGuideGroupAtom,
  skipStepByStepTourAtom,
  startStepByStepTourTaskAtom,
  stepByStepTourEnabledForCurrentWorkspaceAtom,
  stepByStepTourStateErrorAtom,
  uncompleteStepByStepTourTaskAtom,
} from '../state'

const stepByStepTourStateQueryKey = ['console', 'onboarding', 'step-by-step-tour', 'state'] as const
let mockStepByStepTourState: StepByStepTourStateResponse

const applyPatch = (
  state: StepByStepTourStateResponse,
  body: StepByStepTourStatePatchPayload,
): StepByStepTourStateResponse => {
  switch (body.action) {
    case 'complete_task':
      return {
        ...state,
        completed_task_ids: body.task_id
          ? Array.from(new Set([...(state.completed_task_ids ?? []), body.task_id]))
          : state.completed_task_ids,
      }
    case 'uncomplete_task':
      return {
        ...state,
        completed_task_ids: (state.completed_task_ids ?? []).filter(
          (taskId) => taskId !== body.task_id,
        ),
      }
    case 'skip':
      return { ...state, skipped: true }
    case 'enable_current_workspace':
      return {
        ...state,
        skipped: false,
        manually_enabled_workspace_ids: ['workspace-1'],
        manually_disabled_workspace_ids: [],
      }
    case 'disable_current_workspace':
      return {
        ...state,
        manually_enabled_workspace_ids: [],
        manually_disabled_workspace_ids: ['workspace-1'],
      }
  }
}

const patchStepByStepTourState = vi.fn(
  async ({ body }: { body: StepByStepTourStatePatchPayload }) => {
    mockStepByStepTourState = applyPatch(mockStepByStepTourState, body)
    return mockStepByStepTourState
  },
)

vi.mock('@/config', () => ({
  IS_CLOUD_EDITION: true,
}))

vi.mock('@/context/workspace-state', async () => {
  const { atom } = await vi.importActual<typeof import('jotai')>('jotai')

  return { currentWorkspaceIdAtom: atom('workspace-1') }
})

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
            mutationOptions: (options = {}) => ({
              mutationFn: patchStepByStepTourState,
              ...options,
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
  first_workspace_id: 'workspace-1',
  skipped: false,
  completed_task_ids: [],
  manually_enabled_workspace_ids: [],
  manually_disabled_workspace_ids: [],
  updated_at: '2026-07-01T00:00:00Z',
  ...overrides,
})

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, staleTime: Infinity },
    },
  })

describe('step-by-step tour state', () => {
  let queryClient: QueryClient
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    vi.clearAllMocks()
    mockStepByStepTourState = createStepByStepTourState()
    queryClient = createQueryClient()
    store = createStore()
    store.set(queryClientAtom, queryClient)
    queryClient.setQueryData(stepByStepTourStateQueryKey, mockStepByStepTourState)
  })

  it.each([
    ['first workspace', createStepByStepTourState(), true],
    [
      'manual enable',
      createStepByStepTourState({
        first_workspace_id: null,
        manually_enabled_workspace_ids: ['workspace-1'],
      }),
      true,
    ],
    [
      'manual disable wins',
      createStepByStepTourState({ manually_disabled_workspace_ids: ['workspace-1'] }),
      false,
    ],
    ['skipped wins', createStepByStepTourState({ skipped: true }), false],
    [
      'unrelated workspace',
      createStepByStepTourState({ first_workspace_id: 'workspace-2' }),
      false,
    ],
  ])('derives eligibility for %s', (_case, state, expected) => {
    queryClient.setQueryData(stepByStepTourStateQueryKey, state)

    expect(store.get(stepByStepTourEnabledForCurrentWorkspaceAtom)).toBe(expected)
  })

  it('keeps server state and the in-memory session as separate sources', () => {
    queryClient.setQueryData(
      stepByStepTourStateQueryKey,
      createStepByStepTourState({ completed_task_ids: ['home'] }),
    )

    store.set(startStepByStepTourTaskAtom, {
      taskId: 'studio',
      guideGroup: 'studioWithApps',
      guideIndexes: [0, 2],
    })

    expect(store.get(completedStepByStepTourTaskIdsAtom)).toEqual(['home'])
    expect(store.get(activeStepByStepTourTaskIdAtom)).toBe('studio')
    expect(store.get(activeStepByStepTourGuideIndexAtom)).toBe(0)
    expect(store.get(activeStepByStepTourGuideGroupAtom)).toBe('studioWithApps')
    expect(store.get(activeStepByStepTourGuideIndexesAtom)).toEqual([0, 2])
    expect(
      queryClient.getQueryData<StepByStepTourStateResponse>(stepByStepTourStateQueryKey)
        ?.completed_task_ids,
    ).toEqual(['home'])
  })

  it('exposes exact session commands instead of a generic state setter', () => {
    store.set(startStepByStepTourTaskAtom, {
      taskId: 'studio',
      guideGroup: 'studioEmpty',
    })
    store.set(advanceStepByStepTourGuideAtom, { guideIndex: 2, guideIndexes: [0, 2] })
    store.set(resolveStepByStepTourGuideGroupAtom, {
      taskId: 'studio',
      guideGroup: 'studioWithApps',
    })

    expect(store.get(activeStepByStepTourGuideGroupAtom)).toBe('studioWithApps')
    expect(store.get(activeStepByStepTourGuideIndexAtom)).toBe(0)
    expect(store.get(activeStepByStepTourGuideIndexesAtom)).toBeUndefined()

    store.set(resetStepByStepTourSessionAtom)

    expect(store.get(activeStepByStepTourTaskIdAtom)).toBeUndefined()
  })

  it.each([
    [
      completeStepByStepTourTaskAtom,
      { taskId: 'home' },
      { action: 'complete_task', task_id: 'home' },
    ],
    [
      uncompleteStepByStepTourTaskAtom,
      { taskId: 'home' },
      { action: 'uncomplete_task', task_id: 'home' },
    ],
    [skipStepByStepTourAtom, undefined, { action: 'skip' }],
    [
      enableStepByStepTourForCurrentWorkspaceAtom,
      undefined,
      { action: 'enable_current_workspace' },
    ],
    [
      disableStepByStepTourForCurrentWorkspaceAtom,
      undefined,
      { action: 'disable_current_workspace' },
    ],
  ] as const)(
    'sends the generated patch action through a domain command',
    async (command, value, body) => {
      if (value) store.set(command, value)
      else store.set(command)

      await vi.waitFor(() => {
        expect(patchStepByStepTourState.mock.calls[0]?.[0]).toEqual({ body })
      })
    },
  )

  it('replaces the query cache with the canonical mutation response', async () => {
    const onSuccess = vi.fn()

    store.set(completeStepByStepTourTaskAtom, { taskId: 'home', onSuccess })

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(['home'])
    })
    expect(
      queryClient.getQueryData<StepByStepTourStateResponse>(stepByStepTourStateQueryKey)
        ?.completed_task_ids,
    ).toEqual(['home'])
  })

  it('keeps the canonical cache unchanged when a patch fails', async () => {
    const error = new Error('patch failed')
    const onError = vi.fn()
    patchStepByStepTourState.mockRejectedValueOnce(error)
    const unsubscribe = store.sub(stepByStepTourStateErrorAtom, () => {})

    await store.set(completeStepByStepTourTaskAtom, { taskId: 'home', onError })

    expect(onError).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(store.get(stepByStepTourStateErrorAtom)).toBe(error)
    })
    expect(
      queryClient.getQueryData<StepByStepTourStateResponse>(stepByStepTourStateQueryKey)
        ?.completed_task_ids,
    ).toEqual([])
    unsubscribe()
  })
})
