'use client'

import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import type { Getter } from 'jotai'
import type {
  StepByStepTourGuideGroup,
  StepByStepTourSessionState,
  StepByStepTourTaskId,
} from './types'
import { atom } from 'jotai'
import { atomWithMutation, atomWithQuery, queryClientAtom } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { IS_CLOUD_EDITION } from '@/config'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/client'

const stepByStepTourStateQueryKey = () =>
  consoleQuery.onboarding.stepByStepTour.state.get.queryKey()

const stepByStepTourStateQueryAtom = atomWithQuery(() => ({
  ...consoleQuery.onboarding.stepByStepTour.state.get.queryOptions(),
  enabled: IS_CLOUD_EDITION,
}))

const stepByStepTourStateDataAtom = selectAtom(stepByStepTourStateQueryAtom, (query) => query.data)

export const completedStepByStepTourTaskIdsAtom = atom<StepByStepTourTaskId[]>(
  (get) =>
    get(stepByStepTourStateDataAtom)?.completed_task_ids?.filter(
      (taskId): taskId is StepByStepTourTaskId => Boolean(taskId),
    ) ?? [],
)

export const stepByStepTourSkippedAtom = atom((get) =>
  Boolean(get(stepByStepTourStateDataAtom)?.skipped),
)

export const stepByStepTourFirstWorkspaceIdAtom = atom(
  (get) => get(stepByStepTourStateDataAtom)?.first_workspace_id ?? undefined,
)

export const manuallyEnabledStepByStepTourWorkspaceIdsAtom = atom(
  (get) => get(stepByStepTourStateDataAtom)?.manually_enabled_workspace_ids ?? [],
)

export const manuallyDisabledStepByStepTourWorkspaceIdsAtom = atom(
  (get) => get(stepByStepTourStateDataAtom)?.manually_disabled_workspace_ids ?? [],
)

export const stepByStepTourEnabledForCurrentWorkspaceAtom = atom((get) => {
  const state = get(stepByStepTourStateDataAtom)
  const currentWorkspaceId = get(currentWorkspaceIdAtom)

  if (!currentWorkspaceId || state?.skipped) return false

  const manuallyDisabledWorkspaceIds = state?.manually_disabled_workspace_ids ?? []
  const manuallyEnabledWorkspaceIds = state?.manually_enabled_workspace_ids ?? []

  return (
    !manuallyDisabledWorkspaceIds.includes(currentWorkspaceId) &&
    (state?.first_workspace_id === currentWorkspaceId ||
      manuallyEnabledWorkspaceIds.includes(currentWorkspaceId))
  )
})

const initialStepByStepTourSessionState: StepByStepTourSessionState = {
  activeTaskId: undefined,
  activeGuideIndex: undefined,
  activeGuideGroup: undefined,
  activeGuideIndexes: undefined,
}

export const stepByStepTourSessionAtom = atom<StepByStepTourSessionState>(
  initialStepByStepTourSessionState,
)

export const activeStepByStepTourTaskIdAtom = atom(
  (get) => get(stepByStepTourSessionAtom).activeTaskId,
)

export const activeStepByStepTourGuideIndexAtom = atom(
  (get) => get(stepByStepTourSessionAtom).activeGuideIndex,
)

export const activeStepByStepTourGuideGroupAtom = atom(
  (get) => get(stepByStepTourSessionAtom).activeGuideGroup,
)

export const activeStepByStepTourGuideIndexesAtom = atom(
  (get) => get(stepByStepTourSessionAtom).activeGuideIndexes,
)

export const stepByStepTourSkipRecoveryVisibleAtom = atom(false)

export const startStepByStepTourTaskAtom = atom(
  null,
  (
    _get,
    set,
    {
      taskId,
      guideGroup,
      guideIndexes,
    }: {
      taskId: StepByStepTourTaskId
      guideGroup?: StepByStepTourGuideGroup
      guideIndexes?: number[]
    },
  ) => {
    set(stepByStepTourSessionAtom, {
      activeTaskId: taskId,
      activeGuideIndex: 0,
      activeGuideGroup: guideGroup,
      activeGuideIndexes: guideIndexes,
    })
  },
)

export const advanceStepByStepTourGuideAtom = atom(
  null,
  (
    get,
    set,
    {
      guideIndex,
      guideIndexes,
    }: {
      guideIndex: number
      guideIndexes?: number[]
    },
  ) => {
    set(stepByStepTourSessionAtom, {
      ...get(stepByStepTourSessionAtom),
      activeGuideIndex: guideIndex,
      activeGuideIndexes: guideIndexes,
    })
  },
)

export const resolveStepByStepTourGuideGroupAtom = atom(
  null,
  (
    get,
    set,
    {
      taskId,
      guideGroup,
    }: {
      taskId: StepByStepTourTaskId
      guideGroup: StepByStepTourGuideGroup
    },
  ) => {
    const session = get(stepByStepTourSessionAtom)
    if (session.activeTaskId !== taskId || session.activeGuideGroup === guideGroup) return

    set(stepByStepTourSessionAtom, {
      ...session,
      activeGuideGroup: guideGroup,
      activeGuideIndex: 0,
      activeGuideIndexes: undefined,
    })
  },
)

export const resetStepByStepTourSessionAtom = atom(null, (_get, set) => {
  set(stepByStepTourSessionAtom, initialStepByStepTourSessionState)
})

type StepByStepTourStateCommandOptions = {
  onSuccess?: (completedTaskIds: StepByStepTourTaskId[]) => void
  onError?: () => void
}

const patchStepByStepTourStateMutationAtom = atomWithMutation((get) => {
  const queryClient = get(queryClientAtom)

  return consoleQuery.onboarding.stepByStepTour.state.patch.mutationOptions({
    onSuccess: (state) => {
      queryClient.setQueryData(stepByStepTourStateQueryKey(), state)
    },
  })
})

export const stepByStepTourStateUpdatingAtom = atom(
  (get) => get(patchStepByStepTourStateMutationAtom).isPending,
)

export const stepByStepTourStateErrorAtom = atom(
  (get) => get(patchStepByStepTourStateMutationAtom).error,
)

const patchStepByStepTourState = async (
  get: Getter,
  body: StepByStepTourStatePatchPayload,
  options?: StepByStepTourStateCommandOptions,
) => {
  if (!IS_CLOUD_EDITION) return

  const mutation = get(patchStepByStepTourStateMutationAtom)
  if (mutation.isPending) return

  try {
    const state: StepByStepTourStateResponse = await mutation.mutateAsync({ body })
    options?.onSuccess?.(
      state.completed_task_ids?.filter((taskId): taskId is StepByStepTourTaskId =>
        Boolean(taskId),
      ) ?? [],
    )
  } catch {
    options?.onError?.()
  }
}

export const skipStepByStepTourAtom = atom(
  null,
  (get, _set, options?: StepByStepTourStateCommandOptions) => {
    return patchStepByStepTourState(get, { action: 'skip' }, options)
  },
)

export const completeStepByStepTourTaskAtom = atom(
  null,
  (
    get,
    _set,
    { taskId, ...options }: StepByStepTourStateCommandOptions & { taskId: StepByStepTourTaskId },
  ) => {
    return patchStepByStepTourState(get, { action: 'complete_task', task_id: taskId }, options)
  },
)

export const uncompleteStepByStepTourTaskAtom = atom(
  null,
  (
    get,
    _set,
    { taskId, ...options }: StepByStepTourStateCommandOptions & { taskId: StepByStepTourTaskId },
  ) => {
    return patchStepByStepTourState(get, { action: 'uncomplete_task', task_id: taskId }, options)
  },
)

export const enableStepByStepTourForCurrentWorkspaceAtom = atom(
  null,
  (get, _set, options?: StepByStepTourStateCommandOptions) => {
    return patchStepByStepTourState(get, { action: 'enable_current_workspace' }, options)
  },
)

export const disableStepByStepTourForCurrentWorkspaceAtom = atom(
  null,
  (get, _set, options?: StepByStepTourStateCommandOptions) => {
    return patchStepByStepTourState(get, { action: 'disable_current_workspace' }, options)
  },
)
