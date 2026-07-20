'use client'

import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { Getter, Setter } from 'jotai'
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

const stepByStepTourStateMutationScope = {
  id: 'step-by-step-tour-state',
}

const stepByStepTourStateQueryAtom = atomWithQuery(() =>
  consoleQuery.onboarding.stepByStepTour.state.get.queryOptions({
    enabled: IS_CLOUD_EDITION,
  }),
)

const canonicalStepByStepTourStateAtom = selectAtom(
  stepByStepTourStateQueryAtom,
  (query) => query.data,
)

type PendingStepByStepTourStateCommand = {
  body: StepByStepTourStatePatchPayload
  id: symbol
  workspaceId?: string
}

const pendingStepByStepTourStateCommandsAtom = atom<PendingStepByStepTourStateCommand[]>([])
const stepByStepTourStateReconciliationRevisionAtom = atom(0)

const addId = <T extends string>(values: T[] | undefined, value: T | null | undefined): T[] => {
  const nextValues = values ?? []
  if (!value || nextValues.includes(value)) return nextValues

  return [...nextValues, value]
}

const removeId = <T extends string>(values: T[] | undefined, value: T | null | undefined): T[] => {
  if (!value) return values ?? []

  return (values ?? []).filter((item) => item !== value)
}

const applyStepByStepTourStateCommand = (
  state: StepByStepTourStateResponse | undefined,
  command: PendingStepByStepTourStateCommand,
): StepByStepTourStateResponse => {
  const currentState = state ?? {}
  const { body, workspaceId } = command

  switch (body.action) {
    case 'complete_task':
      return {
        ...currentState,
        completed_task_ids: addId(currentState.completed_task_ids, body.task_id),
      }
    case 'uncomplete_task':
      return {
        ...currentState,
        completed_task_ids: removeId(currentState.completed_task_ids, body.task_id),
      }
    case 'skip':
      return {
        ...currentState,
        skipped: true,
        manually_enabled_workspace_ids: removeId(
          currentState.manually_enabled_workspace_ids,
          workspaceId,
        ),
      }
    case 'enable_current_workspace':
      return {
        ...currentState,
        skipped: false,
        manually_enabled_workspace_ids: addId(
          currentState.manually_enabled_workspace_ids,
          workspaceId,
        ),
        manually_disabled_workspace_ids: removeId(
          currentState.manually_disabled_workspace_ids,
          workspaceId,
        ),
      }
    case 'disable_current_workspace':
      return {
        ...currentState,
        manually_enabled_workspace_ids: removeId(
          currentState.manually_enabled_workspace_ids,
          workspaceId,
        ),
        manually_disabled_workspace_ids: addId(
          currentState.manually_disabled_workspace_ids,
          workspaceId,
        ),
      }
  }
}

const stepByStepTourStateDataAtom = atom((get) =>
  get(pendingStepByStepTourStateCommandsAtom).reduce(
    applyStepByStepTourStateCommand,
    get(canonicalStepByStepTourStateAtom),
  ),
)

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

const stepByStepTourStateCommandErrorAtom = atom<unknown>(null)

const settleStepByStepTourStateCommand = async (
  get: Getter,
  set: Setter,
  queryClient: QueryClient,
  command: PendingStepByStepTourStateCommand,
) => {
  set(pendingStepByStepTourStateCommandsAtom, (commands) =>
    commands.filter(({ id }) => id !== command.id),
  )

  const reconciliationRevision = get(stepByStepTourStateReconciliationRevisionAtom)
  const hasPendingCommands = get(pendingStepByStepTourStateCommandsAtom).length > 0

  if (reconciliationRevision > 0 && !hasPendingCommands) {
    await queryClient
      .invalidateQueries({
        exact: true,
        queryKey: stepByStepTourStateQueryKey(),
      })
      .catch(() => undefined)

    const reconciliationIsCurrent =
      get(stepByStepTourStateReconciliationRevisionAtom) === reconciliationRevision
    if (get(pendingStepByStepTourStateCommandsAtom).length === 0 && reconciliationIsCurrent)
      set(stepByStepTourStateReconciliationRevisionAtom, 0)
  }
}

const patchStepByStepTourStateMutationAtom = atomWithMutation((get) => {
  const queryClient = get(queryClientAtom)

  return consoleQuery.onboarding.stepByStepTour.state.patch.mutationOptions({
    scope: stepByStepTourStateMutationScope,
    onMutate: () => {
      return queryClient.cancelQueries({
        exact: true,
        queryKey: stepByStepTourStateQueryKey(),
      })
    },
  })
})

export const stepByStepTourStateUpdatingAtom = atom(
  (get) => get(pendingStepByStepTourStateCommandsAtom).length > 0,
)

export const stepByStepTourStateErrorAtom = atom((get) => get(stepByStepTourStateCommandErrorAtom))

const patchStepByStepTourState = async (
  get: Getter,
  set: Setter,
  body: StepByStepTourStatePatchPayload,
  options?: StepByStepTourStateCommandOptions,
) => {
  if (!IS_CLOUD_EDITION) return

  const command: PendingStepByStepTourStateCommand = {
    body,
    id: Symbol('step-by-step-tour-state-command'),
    workspaceId: get(currentWorkspaceIdAtom) || undefined,
  }
  const mutation = get(patchStepByStepTourStateMutationAtom)
  const queryClient = get(queryClientAtom)
  set(pendingStepByStepTourStateCommandsAtom, (commands) => [...commands, command])
  set(stepByStepTourStateCommandErrorAtom, null)

  let state: Awaited<ReturnType<typeof mutation.mutateAsync>>
  try {
    state = await mutation.mutateAsync({ body })
  } catch (error) {
    set(stepByStepTourStateCommandErrorAtom, error)
    set(stepByStepTourStateReconciliationRevisionAtom, (revision) => revision + 1)
    const reconciliation = settleStepByStepTourStateCommand(get, set, queryClient, command)
    options?.onError?.()
    await reconciliation
    return
  }

  queryClient.setQueryData(stepByStepTourStateQueryKey(), state)
  set(stepByStepTourStateCommandErrorAtom, null)
  const reconciliation = settleStepByStepTourStateCommand(get, set, queryClient, command)
  options?.onSuccess?.(
    state.completed_task_ids?.filter((taskId): taskId is StepByStepTourTaskId => Boolean(taskId)) ??
      [],
  )
  await reconciliation
}

export const skipStepByStepTourAtom = atom(
  null,
  (get, set, options?: StepByStepTourStateCommandOptions) => {
    return patchStepByStepTourState(get, set, { action: 'skip' }, options)
  },
)

export const completeStepByStepTourTaskAtom = atom(
  null,
  (
    get,
    set,
    { taskId, ...options }: StepByStepTourStateCommandOptions & { taskId: StepByStepTourTaskId },
  ) => {
    return patchStepByStepTourState(get, set, { action: 'complete_task', task_id: taskId }, options)
  },
)

export const uncompleteStepByStepTourTaskAtom = atom(
  null,
  (
    get,
    set,
    { taskId, ...options }: StepByStepTourStateCommandOptions & { taskId: StepByStepTourTaskId },
  ) => {
    return patchStepByStepTourState(
      get,
      set,
      { action: 'uncomplete_task', task_id: taskId },
      options,
    )
  },
)

export const enableStepByStepTourForCurrentWorkspaceAtom = atom(
  null,
  (get, set, options?: StepByStepTourStateCommandOptions) => {
    return patchStepByStepTourState(get, set, { action: 'enable_current_workspace' }, options)
  },
)

export const disableStepByStepTourForCurrentWorkspaceAtom = atom(
  null,
  (get, set, options?: StepByStepTourStateCommandOptions) => {
    return patchStepByStepTourState(get, set, { action: 'disable_current_workspace' }, options)
  },
)
