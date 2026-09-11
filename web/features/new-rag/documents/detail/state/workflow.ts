import type { Getter, Setter } from 'jotai'
import type { RefreshDocumentWritePermission } from '../write-permission'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import {
  atomWithInfiniteQuery,
  atomWithMutation,
  atomWithQuery,
  queryClientAtom,
} from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/console'
import { backgroundTaskListFromApi, documentTaskListFromApi } from '../../models'
import { resolveDocumentTask } from '../../tasks/snapshot'
import { responseStatus } from '../model'
import { documentDetailDocumentIdAtom, documentDetailKnowledgeSpaceIdAtom } from './inputs'
import { documentDetailDocumentAtom } from './queries'

const TASK_PAGE_SIZE = 100
const ACTIVE_TASK_REFRESH_INTERVAL = 5000
const REINDEX_STORAGE_PREFIX = 'dify-new-rag-reindex'

export const DOCUMENT_REINDEX_RESTRICTION_ID = 'document-reindex-restriction'

type SubmittedReindex = {
  taskId: string
}

type DocumentWorkflowState = {
  acceptedTaskId?: string
  cancelBusy: boolean
  documentMissing: boolean
  identity: string
  initialized: boolean
  invalidatedTerminalTask?: string
  permissionRecoveryBusy: boolean
  permissionRecoveryNeeded: boolean
  previousTaskState?: string
  reindexBusy: boolean
  submittedReindex?: SubmittedReindex
  writePermissionRevoked: boolean
}

export const documentHasEditPermissionAtom = atom(false)
export const documentTaskDrawerOpenAtom = atom(false)

function workflowIdentity(get: Getter) {
  return `${get(documentDetailKnowledgeSpaceIdAtom)}:${get(documentDetailDocumentIdAtom)}`
}

function initialWorkflowState(identity: string): DocumentWorkflowState {
  return {
    cancelBusy: false,
    documentMissing: false,
    identity,
    initialized: false,
    permissionRecoveryBusy: false,
    permissionRecoveryNeeded: false,
    reindexBusy: false,
    writePermissionRevoked: false,
  }
}

const documentWorkflowStateAtom = atom(initialWorkflowState(''))

export const documentWorkflowScopedAtoms = [
  documentHasEditPermissionAtom,
  documentTaskDrawerOpenAtom,
  documentWorkflowStateAtom,
] as const

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
    if (!value || typeof value !== 'object' || typeof value.taskId !== 'string') return
    return { taskId: value.taskId }
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

function documentTaskIsActive(state: string | undefined) {
  return (
    state === 'dispatch_pending' ||
    state === 'queued' ||
    state === 'running' ||
    state === 'retry_wait'
  )
}

const documentTasksQueryOptionsAtom = atom((get) => {
  const drawerOpen = get(documentTaskDrawerOpenAtom)
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
    enabled: drawerOpen,
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
      if (!drawerOpen || responseStatus(query.state.error) === 403) return false
      // The drawer also shows bulk and source tasks, which the document snapshot cannot update.
      const hasActiveTasks = query.state.data?.pages.some((page) =>
        page.data.some((task) => documentTaskIsActive(task.state)),
      )
      return hasActiveTasks ? ACTIVE_TASK_REFRESH_INTERVAL : false
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

const documentTaskSnapshotQueryAtom = atomWithQuery((get) => {
  const submitted = get(currentSubmittedReindexAtom)
  const document = get(documentDetailDocumentAtom)
  const documentTask = document.latestTask
  const taskId = submitted?.taskId ?? documentTask?.id
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.queryOptions({
    input: taskId
      ? {
          params: { control_space_id: get(documentDetailKnowledgeSpaceIdAtom) },
          query: { task_ids: taskId },
        }
      : skipToken,
    refetchInterval: (query) => {
      if (responseStatus(query.state.error) === 403) return false
      const task = resolveDocumentTask(
        document,
        query.state.data ? documentTaskListFromApi(query.state.data).items[0] : undefined,
        submitted?.taskId,
      )
      return submitted || documentTaskIsActive(task?.state) ? ACTIVE_TASK_REFRESH_INTERVAL : false
    },
  })
})

const documentTaskSnapshotDataAtom = selectAtom(
  documentTaskSnapshotQueryAtom,
  (query) => query.data,
)

export const documentTaskSnapshotErrorAtom = selectAtom(
  documentTaskSnapshotQueryAtom,
  (query) => query.error,
)
export const retryDocumentTaskSnapshotAtom = atom(null, (get) =>
  get(documentTaskSnapshotQueryAtom).refetch(),
)

export const documentLatestTaskAtom = atom((get) => {
  const submitted = get(currentSubmittedReindexAtom)
  const document = get(documentDetailDocumentAtom)
  const snapshot = get(documentTaskSnapshotDataAtom)
  return resolveDocumentTask(
    document,
    snapshot ? documentTaskListFromApi(snapshot).items[0] : undefined,
    submitted?.taskId,
  )
})

const documentTaskIsActiveAtom = atom((get) =>
  documentTaskIsActive(get(documentLatestTaskAtom)?.state),
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
    // Match both history and exact snapshots in this space after task controls.
    tasks: consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
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

async function retryWritePermission(
  get: Getter,
  set: Setter,
  refreshWritePermission: RefreshDocumentWritePermission,
) {
  if (workflowState(get).permissionRecoveryBusy) return false
  updateWorkflowState(get, set, (state) => ({ ...state, permissionRecoveryBusy: true }))
  try {
    const granted = await refreshWritePermission()
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

export const retryDocumentTasksAtom = atom(null, (get) => {
  const query = get(documentTasksQueryAtom)
  if (query.isFetchNextPageError) return query.fetchNextPage()
  return query.refetch()
})

export const refreshDocumentTasksAtom = atom(null, (get) =>
  get(queryClientAtom).invalidateQueries({ queryKey: workflowQueryKeys(get).tasks }),
)

export const retryDocumentWritePermissionAtom = atom(
  null,
  (get, set, refreshWritePermission: RefreshDocumentWritePermission) =>
    retryWritePermission(get, set, refreshWritePermission),
)

export const reindexDocumentAtom = atom(
  null,
  async (get, set, refreshWritePermission: RefreshDocumentWritePermission) => {
    const state = workflowState(get)
    if (state.reindexBusy) return 'unavailable' as const
    updateWorkflowState(get, set, (current) => ({ ...current, reindexBusy: true }))
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
        return 'document-missing' as const
      }
      if (item.status === 'failed' || item.status === 'disabled') {
        await invalidateDocumentWorkflow(get)
        return 'failed' as const
      }
      const taskId =
        typeof item.compilation_job?.id === 'string' ? item.compilation_job.id : undefined
      if (!taskId) throw new Error('Re-index response did not include a compilation task id')
      updateWorkflowState(get, set, (current) => ({
        ...current,
        submittedReindex: { taskId },
      }))
      await invalidateDocumentWorkflow(get)
      return 'started' as const
    } catch (error) {
      if (responseStatus(error) === 403) {
        updateWorkflowState(get, set, (current) => ({ ...current, writePermissionRevoked: true }))
        await retryWritePermission(get, set, refreshWritePermission)
      }
      return 'failed' as const
    } finally {
      updateWorkflowState(get, set, (current) => ({ ...current, reindexBusy: false }))
    }
  },
)

export const cancelDocumentReindexAtom = atom(
  null,
  async (get, set, refreshWritePermission: RefreshDocumentWritePermission) => {
    const state = workflowState(get)
    const task = get(documentLatestTaskAtom)
    const taskId = state.submittedReindex?.taskId ?? task?.id
    if (
      state.cancelBusy ||
      !taskId ||
      (!state.submittedReindex &&
        (!task || !documentTaskIsActive(task.state) || task.canCancel === false))
    )
      return 'unavailable' as const
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
      return 'canceled' as const
    } catch (error) {
      if (responseStatus(error) === 403) {
        updateWorkflowState(get, set, (current) => ({ ...current, writePermissionRevoked: true }))
        await retryWritePermission(get, set, refreshWritePermission)
      }
      return 'failed' as const
    } finally {
      updateWorkflowState(get, set, (current) => ({ ...current, cancelBusy: false }))
    }
  },
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
    !get(documentTaskSnapshotErrorAtom),
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
    get(documentTaskIsActiveAtom) ||
    get(documentSubmissionPendingAtom) ||
    !document.enabled ||
    document.status === 'deleting' ||
    Boolean(get(documentTaskSnapshotErrorAtom))
  )
})
