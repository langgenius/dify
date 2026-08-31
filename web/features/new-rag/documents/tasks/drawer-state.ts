import type { BackgroundTask } from '../models'
import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { taskCanCancel, taskCanRetry } from '../model'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import {
  documentsByIdAtom,
  documentsQueryErrorAtom,
  documentsQueryFetchNextPageAtom,
  documentsQueryHasNextPageAtom,
  documentsQueryIsFetchingAtom,
  documentsQueryIsFetchingNextPageAtom,
  documentsQueryIsFetchNextPageErrorAtom,
  documentsQueryRefetchAtom,
  sourceNamesAtom,
  tasksQueryErrorAtom,
  tasksQueryFetchNextPageAtom,
  tasksQueryHasNextPageAtom,
  tasksQueryIsFetchingAtom,
  tasksQueryIsFetchingNextPageAtom,
  tasksQueryIsFetchNextPageErrorAtom,
  tasksQueryIsPendingAtom,
  tasksQueryRefetchAtom,
} from '../state/queries'
import { unresolvedTaskDocumentIdsAtom } from '../state/results'
import { documentCanReadAtom, documentCanWriteAtom } from '../state/runtime'
import { documentTaskDrawerVisibleLimitAtom, documentTasksOpenAtom } from '../state/scoped'
import { selectTaskDrawerTasks, TASK_DRAWER_LIMIT } from './drawer-model'
import { drawerTasksAtom } from './state'

export const taskDrawerOpenAtom = atom(
  (get) => get(documentTasksOpenAtom) && get(documentCanReadAtom),
)

export const taskDrawerOrderedBaseTasksAtom = atom((get) => {
  if (!get(taskDrawerOpenAtom)) return []
  return selectTaskDrawerTasks(get(drawerTasksAtom), get(documentTaskDrawerVisibleLimitAtom))
})

export const taskDrawerActionCountsAtom = atom((get) => {
  const tasks = get(taskDrawerOrderedBaseTasksAtom)
  return {
    cancel: tasks.filter(taskCanCancel).length,
    retry: tasks.filter(taskCanRetry).length,
  }
})

export const taskDrawerDocumentsPendingAtom = atom((get) => {
  return Boolean(get(documentsQueryHasNextPageAtom) || get(documentsQueryIsFetchingNextPageAtom))
})

export const taskDrawerQueryRecoveryFactsAtom = atom((get) => ({
  documentError: Boolean(
    (get(documentsQueryErrorAtom) || get(documentsQueryIsFetchNextPageErrorAtom)) &&
    get(unresolvedTaskDocumentIdsAtom).size,
  ),
  documentFetching: get(documentsQueryIsFetchingAtom),
  taskError: Boolean(get(tasksQueryErrorAtom) || get(tasksQueryIsFetchNextPageErrorAtom)),
  taskFetching: get(tasksQueryIsFetchingAtom),
}))

const taskDrawerPaginationStateAtom = atom((get) => {
  const orderedTaskCount = get(taskDrawerOrderedBaseTasksAtom).length
  const tasks = get(drawerTasksAtom)
  const hasNextTaskPage = Boolean(get(tasksQueryHasNextPageAtom))
  const hasUnresolvedTaskDocuments = get(unresolvedTaskDocumentIdsAtom).size > 0
  const hasNextDocumentPage = Boolean(get(documentsQueryHasNextPageAtom))

  return {
    fetching: Boolean(
      get(tasksQueryIsFetchingNextPageAtom) || get(documentsQueryIsFetchingNextPageAtom),
    ),
    hasMore: Boolean(
      get(taskDrawerOpenAtom) &&
      (tasks.length > orderedTaskCount ||
        hasNextTaskPage ||
        (hasUnresolvedTaskDocuments && hasNextDocumentPage)),
    ),
    hasNextDocumentPage,
    hasNextTaskPage,
    hasUnresolvedTaskDocuments,
    orderedTaskCount,
    taskCount: tasks.length,
  }
})

export const taskDrawerLoadMoreFactsAtom = atom((get) => {
  const pagination = get(taskDrawerPaginationStateAtom)
  return { fetching: pagination.fetching, hasMore: pagination.hasMore }
})

export const taskDrawerRowsStateAtom = atom((get) => ({
  isPending: get(tasksQueryIsPendingAtom),
  showEmpty: Boolean(
    !get(tasksQueryIsPendingAtom) &&
    !get(tasksQueryErrorAtom) &&
    !get(tasksQueryIsFetchNextPageErrorAtom) &&
    !get(taskDrawerPaginationStateAtom).hasMore &&
    !get(taskDrawerOrderedBaseTasksAtom).length,
  ),
}))

export const taskDrawerActionFactsAtom = atom((get) => {
  const actionCounts = get(taskDrawerActionCountsAtom)
  return {
    canRead: get(documentCanReadAtom),
    canWrite: get(documentCanWriteAtom),
    includeCancelTarget: actionCounts.cancel > 1,
    includeRetryTarget: actionCounts.retry > 1,
    knowledgeSpaceId: get(documentsKnowledgeSpaceIdAtom),
  }
})

export const createTaskDrawerRowLabelsAtom = (task: BackgroundTask) => {
  const labelsAtom = atom((get) => ({
    documentTitle:
      task.documentTitle ??
      (task.documentId ? get(documentsByIdAtom).get(task.documentId)?.title : undefined),
    documentTitlePending: Boolean(
      task.documentId && !task.documentTitle && get(taskDrawerDocumentsPendingAtom),
    ),
    sourceTitle: task.sourceId ? get(sourceNamesAtom).get(task.sourceId) : undefined,
  }))
  return selectAtom(
    labelsAtom,
    (labels) => labels,
    (left, right) =>
      left.documentTitle === right.documentTitle &&
      left.documentTitlePending === right.documentTitlePending &&
      left.sourceTitle === right.sourceTitle,
  )
}

export const retryTaskDrawerDocumentsAtom = atom(null, (get) => {
  if (get(documentsQueryIsFetchNextPageErrorAtom)) void get(documentsQueryFetchNextPageAtom)()
  else void get(documentsQueryRefetchAtom)()
})

export const retryTaskDrawerTasksAtom = atom(null, (get) => {
  if (get(tasksQueryIsFetchNextPageErrorAtom)) void get(tasksQueryFetchNextPageAtom)()
  else void get(tasksQueryRefetchAtom)()
})

export const showMoreTaskDrawerResultsAtom = atom(null, (get, set) => {
  const pagination = get(taskDrawerPaginationStateAtom)
  if (pagination.taskCount <= pagination.orderedTaskCount && pagination.hasNextTaskPage)
    void get(tasksQueryFetchNextPageAtom)()
  if (pagination.hasUnresolvedTaskDocuments && pagination.hasNextDocumentPage)
    void get(documentsQueryFetchNextPageAtom)()
  set(documentTaskDrawerVisibleLimitAtom, (current) => current + TASK_DRAWER_LIMIT)
})

export const resetTaskDrawerResultsWindowAtom = atom(null, (_get, set) => {
  set(documentTaskDrawerVisibleLimitAtom, TASK_DRAWER_LIMIT)
})
