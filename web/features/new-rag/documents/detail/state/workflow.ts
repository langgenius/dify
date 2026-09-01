import type { Getter, Setter } from 'jotai'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import {
  atomWithInfiniteQuery,
  atomWithMutation,
  atomWithQuery,
  queryClientAtom,
} from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { newestTaskByDocument } from '../../model'
import { backgroundTaskListFromApi, documentTaskListFromApi } from '../../models'
import { responseStatus } from '../model'
import { documentDetailDocumentIdAtom, documentDetailKnowledgeSpaceIdAtom } from './inputs'
import { documentDetailDocumentAtom } from './queries'

const TASK_PAGE_SIZE = 100
const TASK_LOOKUP_PAGE_BATCH = 3
const ACTIVE_TASK_REFRESH_INTERVAL = 5000
const SUBMISSION_DISCOVERY_REFRESH_INTERVAL = 2000
const REINDEX_STORAGE_PREFIX = 'dify-new-rag-reindex'

export const DOCUMENT_REINDEX_RESTRICTION_ID = 'document-reindex-restriction'

type SubmittedReindex = {
  baselineRevision: number
  taskId: string
}

type DocumentWorkflowState = {
  acceptedTaskId?: string
  cancelBusy: boolean
  documentMissing: boolean
  identity: string
  initialized: boolean
  invalidatedTerminalTask?: string
  lookupPageLimit: number
  permissionRecoveryBusy: boolean
  permissionRecoveryNeeded: boolean
  previousTaskState?: string
  reindexBusy: boolean
  submittedReindex?: SubmittedReindex
  writePermissionRevoked: boolean
}

type DocumentWorkflowRuntime = {
  hasEditPermission: boolean
  messages: {
    actionFailed: string
    documentMissing: string
    reindexFailed: string
    reindexStarted: string
  }
  refreshWritePermission: () => Promise<boolean>
}

function unavailableRuntime(): never {
  throw new Error('Document workflow runtime is unavailable')
}

export const documentWorkflowRuntimeAtom = atom<DocumentWorkflowRuntime>({
  hasEditPermission: false,
  messages: {
    actionFailed: '',
    documentMissing: '',
    reindexFailed: '',
    reindexStarted: '',
  },
  refreshWritePermission: async () => unavailableRuntime(),
})

function workflowIdentity(get: Getter) {
  return `${get(documentDetailKnowledgeSpaceIdAtom)}:${get(documentDetailDocumentIdAtom)}`
}

function initialWorkflowState(identity: string): DocumentWorkflowState {
  return {
    cancelBusy: false,
    documentMissing: false,
    identity,
    initialized: false,
    lookupPageLimit: TASK_LOOKUP_PAGE_BATCH,
    permissionRecoveryBusy: false,
    permissionRecoveryNeeded: false,
    reindexBusy: false,
    writePermissionRevoked: false,
  }
}

const documentWorkflowStateAtom = atom(initialWorkflowState(''))

function workflowState(get: Getter) {
  const identity = workflowIdentity(get)
  const state = get(documentWorkflowStateAtom)
  return state.identity === identity ? state : initialWorkflowState(identity)
}

const currentDocumentWorkflowStateAtom = atom(workflowState)
const currentSubmittedReindexAtom = selectAtom(
  currentDocumentWorkflowStateAtom,
  (state) => state.submittedReindex,
)

function updateWorkflowState(
  get: Getter,
  set: Setter,
  update: (state: DocumentWorkflowState) => DocumentWorkflowState,
) {
  const identity = workflowIdentity(get)
  set(documentWorkflowStateAtom, (current) =>
    update(current.identity === identity ? current : initialWorkflowState(identity)),
  )
}

function submittedReindexStorageKey(get: Getter) {
  return `${REINDEX_STORAGE_PREFIX}:${get(documentDetailKnowledgeSpaceIdAtom)}:${get(
    documentDetailDocumentIdAtom,
  )}`
}

function readSubmittedReindex(storageKey: string): SubmittedReindex | undefined {
  try {
    const value = JSON.parse(globalThis.sessionStorage.getItem(storageKey) ?? 'null')
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.baselineRevision !== 'number' ||
      typeof value.taskId !== 'string'
    )
      return
    return { baselineRevision: value.baselineRevision, taskId: value.taskId }
  } catch {
    return undefined
  }
}

function compilationJobIsTerminal(job: { run_state?: string | null; stage?: string | null }) {
  return (
    job.run_state === 'succeeded' ||
    job.run_state === 'completed' ||
    job.run_state === 'failed' ||
    job.run_state === 'canceled' ||
    job.run_state === 'superseded' ||
    job.stage === 'published' ||
    job.stage === 'failed' ||
    job.stage === 'canceled'
  )
}

export function documentTaskIsActive(state: string | undefined) {
  return (
    state === 'dispatch_pending' ||
    state === 'queued' ||
    state === 'running' ||
    state === 'retry_wait'
  )
}

const documentTasksQueryOptionsAtom = atom((get) => {
  const documentId = get(documentDetailDocumentIdAtom)
  const submittedReindex = get(currentSubmittedReindexAtom)
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
    input: (pageParam) => ({
      params: { control_space_id: get(documentDetailKnowledgeSpaceIdAtom) },
      query: {
        limit: TASK_PAGE_SIZE,
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
      },
    }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: null as string | null,
    refetchInterval: (query) => {
      const tasks =
        query.state.data?.pages.flatMap((page) => documentTaskListFromApi(page).items) ?? []
      if (tasks.some((task) => task.documentId === documentId && documentTaskIsActive(task.state)))
        return ACTIVE_TASK_REFRESH_INTERVAL
      return submittedReindex ? SUBMISSION_DISCOVERY_REFRESH_INTERVAL : false
    },
  })
})

const documentTasksQueryAtom = atomWithInfiniteQuery((get) => get(documentTasksQueryOptionsAtom))
const documentTasksQueryDataAtom = selectAtom(documentTasksQueryAtom, (query) => query.data)

export const documentTasksQueryErrorAtom = selectAtom(
  documentTasksQueryAtom,
  (query) => query.error,
)
export const documentTasksQueryHasNextPageAtom = selectAtom(
  documentTasksQueryAtom,
  (query) => query.hasNextPage,
)
export const documentTasksQueryIsFetchNextPageErrorAtom = selectAtom(
  documentTasksQueryAtom,
  (query) => query.isFetchNextPageError,
)
export const documentTasksQueryIsFetchingAtom = selectAtom(
  documentTasksQueryAtom,
  (query) => query.isFetching,
)
export const documentTasksQueryIsFetchingNextPageAtom = selectAtom(
  documentTasksQueryAtom,
  (query) => query.isFetchingNextPage,
)
export const documentTasksQueryIsPendingAtom = selectAtom(
  documentTasksQueryAtom,
  (query) => query.isPending,
)

export const documentBackgroundTasksAtom = atom(
  (get) =>
    get(documentTasksQueryDataAtom)?.pages.flatMap(
      (page) => backgroundTaskListFromApi(page).items,
    ) ?? [],
)

const documentProcessingTasksAtom = atom(
  (get) =>
    get(documentTasksQueryDataAtom)?.pages.flatMap((page) => documentTaskListFromApi(page).items) ??
    [],
)

export const documentLatestTaskAtom = atom((get) => {
  const documentId = get(documentDetailDocumentIdAtom)
  const document = get(documentDetailDocumentAtom)
  const submittedReindex = get(currentSubmittedReindexAtom)
  const tasks = get(documentProcessingTasksAtom)
  const acceptedTask = submittedReindex
    ? tasks.find((candidate) => candidate.id === submittedReindex.taskId)
    : undefined
  if (acceptedTask) return acceptedTask
  const minimumRevision = submittedReindex
    ? submittedReindex.baselineRevision + 1
    : (document.activeRevision ?? document.active?.revision ?? 0)
  const task = newestTaskByDocument(
    tasks.filter(
      (candidate) =>
        candidate.documentId === documentId && candidate.documentRevision >= minimumRevision,
    ),
  ).get(documentId)
  return task && task.documentRevision >= minimumRevision ? task : undefined
})

export const documentTaskIsActiveAtom = atom((get) =>
  documentTaskIsActive(get(documentLatestTaskAtom)?.state),
)

const documentTaskLookupSatisfiedAtom = atom((get) => {
  const submittedReindex = get(currentSubmittedReindexAtom)
  const latestTask = get(documentLatestTaskAtom)
  return submittedReindex ? latestTask?.id === submittedReindex.taskId : Boolean(latestTask)
})

export const documentTaskLookupExhaustedAtom = atom((get) => {
  const state = workflowState(get)
  return Boolean(
    !get(documentTaskLookupSatisfiedAtom) &&
    get(documentTasksQueryHasNextPageAtom) &&
    (get(documentTasksQueryDataAtom)?.pages.length ?? 0) >= state.lookupPageLimit,
  )
})

export const documentTaskIsLookingUpAtom = atom(
  (get) =>
    !get(documentTaskLookupSatisfiedAtom) &&
    get(documentTasksQueryHasNextPageAtom) &&
    !get(documentTaskLookupExhaustedAtom),
)

const submittedJobQueryAtom = atomWithQuery((get) => {
  const submittedReindex = get(currentSubmittedReindexAtom)
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.jobs.byJobId.get.queryOptions({
    input: submittedReindex
      ? {
          params: {
            control_space_id: get(documentDetailKnowledgeSpaceIdAtom),
            job_id: submittedReindex.taskId,
          },
        }
      : skipToken,
    refetchInterval: (query) =>
      query.state.data && !compilationJobIsTerminal(query.state.data) ? 2000 : false,
    retry: (failureCount, error) => responseStatus(error) !== 403 && failureCount < 2,
  })
})

const submittedJobDataAtom = selectAtom(submittedJobQueryAtom, (query) => query.data)
const submittedJobErrorAtom = selectAtom(submittedJobQueryAtom, (query) => query.error)

export const documentSubmittedJobTerminalAtom = atom((get) => {
  const job = get(submittedJobDataAtom)
  return Boolean(job && compilationJobIsTerminal(job))
})

export const documentSubmittedJobMissingAtom = atom(
  (get) => responseStatus(get(submittedJobErrorAtom)) === 404,
)

export const documentSubmissionPendingAtom = atom((get) => {
  const submittedReindex = get(currentSubmittedReindexAtom)
  if (!submittedReindex) return false
  const latestTask = get(documentLatestTaskAtom)
  const submittedTaskObserved = latestTask?.id === submittedReindex.taskId
  const job = get(submittedJobDataAtom)
  return (
    !submittedTaskObserved &&
    !(job && compilationJobIsTerminal(job)) &&
    responseStatus(get(submittedJobErrorAtom)) !== 404
  )
})

const reindexDocumentMutationAtom = atomWithMutation(() =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.reindex.post.mutationOptions(),
)
const cancelTaskMutationAtom = atomWithMutation(() =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.cancel.post.mutationOptions(),
)

function workflowQueryKeys(get: Getter) {
  const knowledgeSpaceId = get(documentDetailKnowledgeSpaceIdAtom)
  const documentId = get(documentDetailDocumentIdAtom)
  return {
    chunks:
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.byRevision.chunks.get.key(),
    document:
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.get.queryOptions(
        {
          input: {
            params: { control_space_id: knowledgeSpaceId, document_id: documentId },
          },
        },
      ).queryKey,
    revisions:
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.get.key(),
    tasks: get(documentTasksQueryOptionsAtom).queryKey,
  }
}

async function invalidateDocumentWorkflow(get: Getter) {
  const queryClient = get(queryClientAtom)
  const keys = workflowQueryKeys(get)
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.document }),
    queryClient.invalidateQueries({ queryKey: keys.revisions }),
    queryClient.invalidateQueries({ queryKey: keys.chunks }),
    queryClient.invalidateQueries({ queryKey: keys.tasks }),
  ])
}

async function retryWritePermission(get: Getter, set: Setter) {
  if (workflowState(get).permissionRecoveryBusy) return false
  updateWorkflowState(get, set, (state) => ({ ...state, permissionRecoveryBusy: true }))
  try {
    const granted = await get(documentWorkflowRuntimeAtom).refreshWritePermission()
    updateWorkflowState(get, set, (state) => ({
      ...state,
      permissionRecoveryNeeded: !granted,
      writePermissionRevoked: granted ? false : state.writePermissionRevoked,
    }))
    return granted
  } catch {
    updateWorkflowState(get, set, (state) => ({ ...state, permissionRecoveryNeeded: true }))
    return false
  } finally {
    updateWorkflowState(get, set, (state) => ({ ...state, permissionRecoveryBusy: false }))
  }
}

export const initializeDocumentWorkflowAtom = atom(null, (get, set) => {
  const identity = workflowIdentity(get)
  const current = get(documentWorkflowStateAtom)
  if (current.identity === identity && current.initialized) return
  set(documentWorkflowStateAtom, {
    ...initialWorkflowState(identity),
    initialized: true,
    submittedReindex: readSubmittedReindex(submittedReindexStorageKey(get)),
  })
})

export const persistDocumentWorkflowAtom = atom(null, (get) => {
  const state = workflowState(get)
  if (!state.initialized) return
  const latestTask = get(documentLatestTaskAtom)
  const submittedTaskIsTerminal = Boolean(
    state.submittedReindex &&
    latestTask?.id === state.submittedReindex.taskId &&
    !documentTaskIsActive(latestTask.state),
  )
  try {
    if (state.submittedReindex && !submittedTaskIsTerminal)
      globalThis.sessionStorage.setItem(
        submittedReindexStorageKey(get),
        JSON.stringify(state.submittedReindex),
      )
    else globalThis.sessionStorage.removeItem(submittedReindexStorageKey(get))
  } catch {
    // Recovery remains available in memory when browser storage is unavailable.
  }
})

export const reconcileDocumentTaskAtom = atom(null, async (get, set) => {
  const state = workflowState(get)
  const latestTask = get(documentLatestTaskAtom)
  const previousWasActive = documentTaskIsActive(state.previousTaskState)
  const taskMatchesSubmission = Boolean(
    latestTask && state.submittedReindex && latestTask.id === state.submittedReindex.taskId,
  )
  const acceptedTaskId = taskMatchesSubmission ? latestTask?.id : state.acceptedTaskId
  const terminalTaskKey = latestTask ? `${latestTask.id}:${latestTask.updatedAt}` : undefined
  const document = get(documentDetailDocumentAtom)
  const activeRevision = document.activeRevision ?? document.active?.revision ?? 0
  const shouldInvalidate = Boolean(
    latestTask &&
    !documentTaskIsActive(latestTask.state) &&
    (previousWasActive ||
      acceptedTaskId === latestTask.id ||
      taskMatchesSubmission ||
      latestTask.documentRevision > activeRevision) &&
    state.invalidatedTerminalTask !== terminalTaskKey,
  )
  updateWorkflowState(get, set, (current) => ({
    ...current,
    acceptedTaskId,
    invalidatedTerminalTask: shouldInvalidate ? terminalTaskKey : current.invalidatedTerminalTask,
    previousTaskState: latestTask?.state,
  }))
  if (shouldInvalidate) await invalidateDocumentWorkflow(get)
})

export const reconcileSubmittedDocumentJobAtom = atom(null, async (get, set) => {
  const submittedReindex = workflowState(get).submittedReindex
  if (!submittedReindex) return
  const job = get(submittedJobDataAtom)
  const terminal = Boolean(job && compilationJobIsTerminal(job))
  const missing = responseStatus(get(submittedJobErrorAtom)) === 404
  if (!terminal && !missing) return
  updateWorkflowState(get, set, (state) => ({ ...state, submittedReindex: undefined }))
  try {
    globalThis.sessionStorage.removeItem(submittedReindexStorageKey(get))
  } catch {
    // Browser storage recovery is optional.
  }
  if (terminal) await invalidateDocumentWorkflow(get)
})

export const loadNextDocumentTaskPageAtom = atom(null, (get) =>
  get(documentTasksQueryAtom).fetchNextPage(),
)

export const continueDocumentTaskLookupAtom = atom(null, (get, set) => {
  updateWorkflowState(get, set, (state) => ({
    ...state,
    lookupPageLimit: state.lookupPageLimit + TASK_LOOKUP_PAGE_BATCH,
  }))
})

export const retryDocumentTasksAtom = atom(null, (get) => {
  const query = get(documentTasksQueryAtom)
  if (query.isFetchNextPageError) return query.fetchNextPage()
  return query.refetch()
})

export const refreshDocumentTasksAtom = atom(null, (get) => get(documentTasksQueryAtom).refetch())

export const retryDocumentWritePermissionAtom = atom(null, retryWritePermission)

export const reindexDocumentAtom = atom(null, async (get, set) => {
  const state = workflowState(get)
  if (state.reindexBusy) return
  updateWorkflowState(get, set, (current) => ({ ...current, reindexBusy: true }))
  const document = get(documentDetailDocumentAtom)
  const activeRevision = document.activeRevision ?? document.active?.revision ?? 0
  try {
    const result = await get(reindexDocumentMutationAtom).mutateAsync({
      body: { documentIds: [get(documentDetailDocumentIdAtom)] },
      params: { control_space_id: get(documentDetailKnowledgeSpaceIdAtom) },
    })
    const item = result.items[0]
    if (!item || item.status === 'not_found') {
      updateWorkflowState(get, set, (current) => ({ ...current, documentMissing: true }))
      const queryClient = get(queryClientAtom)
      const documentQueryKey = workflowQueryKeys(get).document
      queryClient.removeQueries({ queryKey: documentQueryKey })
      await queryClient.invalidateQueries({ queryKey: documentQueryKey })
      toast.error(get(documentWorkflowRuntimeAtom).messages.documentMissing)
      return
    }
    const taskId =
      typeof item.compilation_job?.id === 'string' ? item.compilation_job.id : undefined
    if (!taskId) throw new Error('Re-index response did not include a compilation task id')
    const latestTask = get(documentLatestTaskAtom)
    updateWorkflowState(get, set, (current) => ({
      ...current,
      submittedReindex: {
        baselineRevision: Math.max(activeRevision, latestTask?.documentRevision ?? activeRevision),
        taskId,
      },
    }))
    await invalidateDocumentWorkflow(get)
    toast.success(get(documentWorkflowRuntimeAtom).messages.reindexStarted)
  } catch (error) {
    if (responseStatus(error) === 403) {
      updateWorkflowState(get, set, (current) => ({ ...current, writePermissionRevoked: true }))
      await retryWritePermission(get, set)
    }
    toast.error(get(documentWorkflowRuntimeAtom).messages.reindexFailed)
  } finally {
    updateWorkflowState(get, set, (current) => ({ ...current, reindexBusy: false }))
  }
})

export const cancelDocumentReindexAtom = atom(null, async (get, set) => {
  const state = workflowState(get)
  const task = get(documentLatestTaskAtom)
  const taskId = state.submittedReindex?.taskId ?? task?.id
  if (
    state.cancelBusy ||
    !taskId ||
    (!state.submittedReindex &&
      (!task || !documentTaskIsActive(task.state) || task.canCancel === false))
  )
    return false
  updateWorkflowState(get, set, (current) => ({ ...current, cancelBusy: true }))
  try {
    await get(cancelTaskMutationAtom).mutateAsync({
      params: {
        control_space_id: get(documentDetailKnowledgeSpaceIdAtom),
        task_id: taskId,
        task_kind: task?.id === taskId ? (task.taskKind ?? 'document') : 'document',
      },
    })
    updateWorkflowState(get, set, (current) => ({ ...current, submittedReindex: undefined }))
    await invalidateDocumentWorkflow(get)
    return true
  } catch (error) {
    if (responseStatus(error) === 403) {
      updateWorkflowState(get, set, (current) => ({ ...current, writePermissionRevoked: true }))
      await retryWritePermission(get, set)
    }
    toast.error(get(documentWorkflowRuntimeAtom).messages.actionFailed)
    return false
  } finally {
    updateWorkflowState(get, set, (current) => ({ ...current, cancelBusy: false }))
  }
})

export const documentHasEditPermissionAtom = atom(
  (get) => get(documentWorkflowRuntimeAtom).hasEditPermission,
)
export const documentCanEditAtom = atom(
  (get) => get(documentHasEditPermissionAtom) && !workflowState(get).writePermissionRevoked,
)
export const documentPermissionRecoveryBusyAtom = atom(
  (get) => workflowState(get).permissionRecoveryBusy,
)
export const documentPermissionRecoveryNeededAtom = atom(
  (get) => workflowState(get).permissionRecoveryNeeded,
)
export const documentWorkflowInitializedAtom = atom((get) => workflowState(get).initialized)
export const documentMissingAtom = atom((get) => workflowState(get).documentMissing)
export const documentReindexCancelBusyAtom = atom((get) => workflowState(get).cancelBusy)
export const documentReindexBusyAtom = atom((get) => workflowState(get).reindexBusy)
export const documentReindexInProgressAtom = atom(
  (get) => get(documentSubmissionPendingAtom) || get(documentTaskIsActiveAtom),
)
export const documentCanCancelReindexAtom = atom(
  (get) =>
    get(documentCanEditAtom) &&
    get(documentReindexInProgressAtom) &&
    (get(documentSubmissionPendingAtom) || get(documentLatestTaskAtom)?.canCancel !== false) &&
    !get(documentTasksQueryErrorAtom),
)
export const documentReindexFailedAtom = atom(
  (get) => get(documentLatestTaskAtom)?.state === 'failed',
)
export const documentReindexDisabledReasonIdAtom = atom((get) =>
  get(documentHasEditPermissionAtom) ? undefined : DOCUMENT_REINDEX_RESTRICTION_ID,
)
export const documentReindexDisabledAtom = atom((get) => {
  const document = get(documentDetailDocumentAtom)
  return (
    !get(documentCanEditAtom) ||
    get(documentReindexBusyAtom) ||
    get(documentSubmissionPendingAtom) ||
    get(documentTaskIsActiveAtom) ||
    get(documentTasksQueryIsPendingAtom) ||
    get(documentTasksQueryIsFetchingNextPageAtom) ||
    get(documentTaskIsLookingUpAtom) ||
    get(documentTaskLookupExhaustedAtom) ||
    !document.enabled ||
    document.status === 'deleting' ||
    Boolean(get(documentTasksQueryErrorAtom))
  )
})
