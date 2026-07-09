'use client'

import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import type {
  StepByStepTourAccountState,
  StepByStepTourPersistentState,
  StepByStepTourTaskId,
  StepByStepTourUiState,
} from './types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IS_CLOUD_EDITION } from '@/config'
import { consoleQuery } from '@/service/client'
import {
  useSetStepByStepTourUiState,
  useStepByStepTourUiStateValue,
} from './atoms'

const normalizeTaskIds = (
  taskIds: StepByStepTourStateResponse['completed_task_ids'] | undefined,
): StepByStepTourTaskId[] =>
  taskIds?.filter((taskId): taskId is StepByStepTourTaskId => Boolean(taskId)) ?? []

const normalizeWorkspaceIds = (workspaceIds: string[] | undefined) => workspaceIds ?? []

const normalizePersistentState = (
  state: StepByStepTourStateResponse | undefined,
): StepByStepTourPersistentState => ({
  firstWorkspaceId: state?.first_workspace_id ?? undefined,
  updatedAt: state?.updated_at ?? null,
  manuallyEnabledWorkspaceIds: normalizeWorkspaceIds(state?.manually_enabled_workspace_ids),
  manuallyDisabledWorkspaceIds: normalizeWorkspaceIds(state?.manually_disabled_workspace_ids),
  completedTaskIds: normalizeTaskIds(state?.completed_task_ids),
  skipped: Boolean(state?.skipped),
})

const toStepByStepTourStateResponse = (
  state: StepByStepTourPersistentState,
): StepByStepTourStateResponse => ({
  first_workspace_id: state.firstWorkspaceId ?? null,
  updated_at: state.updatedAt ?? null,
  manually_enabled_workspace_ids: state.manuallyEnabledWorkspaceIds,
  manually_disabled_workspace_ids: state.manuallyDisabledWorkspaceIds,
  completed_task_ids: state.completedTaskIds,
  skipped: state.skipped,
})

const pickUiState = (state: StepByStepTourAccountState | StepByStepTourUiState): StepByStepTourUiState => ({
  activeTaskId: state.activeTaskId,
  activeGuideIndex: state.activeGuideIndex,
  activeGuideGroup: state.activeGuideGroup,
  activeGuideIndexes: state.activeGuideIndexes,
  minimized: state.minimized,
})

const addId = <T extends string>(values: T[], value: T): T[] => {
  if (values.includes(value))
    return values

  return [...values, value]
}

const removeId = <T extends string>(values: T[], value: T): T[] =>
  values.filter(item => item !== value)

const getStepByStepTourStateQueryKey = () =>
  consoleQuery.onboarding.stepByStepTour.state.get.queryKey()

type StepByStepTourStateActionOptions = {
  onSuccess?: (state: StepByStepTourPersistentState) => void
}

export const getStepByStepTourEnabledForCurrentWorkspace = (
  accountState: Pick<
    StepByStepTourAccountState,
    'firstWorkspaceId' | 'manuallyDisabledWorkspaceIds' | 'manuallyEnabledWorkspaceIds' | 'skipped'
  >,
  currentWorkspaceId: string,
) => !accountState.skipped
  && !accountState.manuallyDisabledWorkspaceIds.includes(currentWorkspaceId)
  && (
    accountState.firstWorkspaceId === currentWorkspaceId
    || accountState.manuallyEnabledWorkspaceIds.includes(currentWorkspaceId)
  )

export const useStepByStepTourAccountStateValue = (): StepByStepTourAccountState => {
  const { data } = useQuery({
    ...consoleQuery.onboarding.stepByStepTour.state.get.queryOptions(),
    enabled: IS_CLOUD_EDITION,
  })
  // eslint-disable-next-line react/use-state -- Step-by-step tour UI state hooks are not React useState calls.
  const uiState = pickUiState(useStepByStepTourUiStateValue())

  return {
    ...normalizePersistentState(data),
    ...uiState,
  }
}

export const useSetStepByStepTourAccountState = () => {
  // eslint-disable-next-line react/use-state -- Step-by-step tour UI state hooks are not React useState calls.
  const setUiState = useSetStepByStepTourUiState()

  return (nextState: StepByStepTourAccountState | StepByStepTourUiState) => {
    setUiState(pickUiState(nextState))
  }
}

export const useStepByStepTourStateActions = () => {
  const queryClient = useQueryClient()
  const patchMutation = useMutation(consoleQuery.onboarding.stepByStepTour.state.patch.mutationOptions())
  // eslint-disable-next-line react/use-state -- Step-by-step tour UI state hooks are not React useState calls.
  const setUiState = useSetStepByStepTourUiState()

  const updatePersistentStateCache = (
    updater: (currentState: StepByStepTourPersistentState) => StepByStepTourPersistentState,
  ) => {
    queryClient.setQueryData<StepByStepTourStateResponse | undefined>(
      getStepByStepTourStateQueryKey(),
      currentState => toStepByStepTourStateResponse(updater(normalizePersistentState(currentState))),
    )
  }

  const patchPersistentState = (
    body: StepByStepTourStatePatchPayload,
    optimisticUpdate: (currentState: StepByStepTourPersistentState) => StepByStepTourPersistentState,
    options?: StepByStepTourStateActionOptions,
  ) => {
    if (!IS_CLOUD_EDITION)
      return

    updatePersistentStateCache(optimisticUpdate)
    patchMutation.mutate(
      { body },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getStepByStepTourStateQueryKey(), data)
          options?.onSuccess?.(normalizePersistentState(data))
        },
        onError: () => {
          void queryClient.invalidateQueries({ queryKey: getStepByStepTourStateQueryKey() })
        },
      },
    )
  }

  return {
    setUiState,
    skipTour(currentWorkspaceId: string, options?: StepByStepTourStateActionOptions) {
      patchPersistentState(
        { action: 'skip' },
        currentState => ({
          ...currentState,
          skipped: true,
          manuallyEnabledWorkspaceIds: removeId(currentState.manuallyEnabledWorkspaceIds, currentWorkspaceId),
        }),
        options,
      )
    },
    completeTask(taskId: StepByStepTourTaskId, options?: StepByStepTourStateActionOptions) {
      patchPersistentState(
        { action: 'complete_task', task_id: taskId },
        currentState => ({
          ...currentState,
          completedTaskIds: addId(currentState.completedTaskIds, taskId),
        }),
        options,
      )
    },
    uncompleteTask(taskId: StepByStepTourTaskId, options?: StepByStepTourStateActionOptions) {
      patchPersistentState(
        { action: 'uncomplete_task', task_id: taskId },
        currentState => ({
          ...currentState,
          completedTaskIds: removeId(currentState.completedTaskIds, taskId),
        }),
        options,
      )
    },
    enableCurrentWorkspace(currentWorkspaceId: string, options?: StepByStepTourStateActionOptions) {
      patchPersistentState(
        { action: 'enable_current_workspace' },
        currentState => ({
          ...currentState,
          skipped: false,
          manuallyEnabledWorkspaceIds: addId(currentState.manuallyEnabledWorkspaceIds, currentWorkspaceId),
          manuallyDisabledWorkspaceIds: removeId(currentState.manuallyDisabledWorkspaceIds, currentWorkspaceId),
        }),
        options,
      )
    },
    disableCurrentWorkspace(currentWorkspaceId: string, options?: StepByStepTourStateActionOptions) {
      patchPersistentState(
        { action: 'disable_current_workspace' },
        currentState => ({
          ...currentState,
          manuallyEnabledWorkspaceIds: removeId(currentState.manuallyEnabledWorkspaceIds, currentWorkspaceId),
          manuallyDisabledWorkspaceIds: addId(currentState.manuallyDisabledWorkspaceIds, currentWorkspaceId),
        }),
        options,
      )
    },
  }
}
