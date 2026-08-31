import { atom } from 'jotai'
import { MAX_AUTO_CURSOR_PAGES } from '../tasks/recovery'
import {
  documentPermissionDeniedAtom,
  documentsQueryErrorAtom,
  documentsQueryHasDataAtom,
  documentsQueryHasNextPageAtom,
  documentsQueryIsFetchingAtom,
  documentsQueryIsFetchingNextPageAtom,
  documentsQueryIsFetchNextPageErrorAtom,
  documentsQueryIsPendingAtom,
  documentsQueryIsRefetchingAtom,
  documentsQueryPageCountAtom,
  documentsQueryRefetchAtom,
  sourcePermissionDeniedAtom,
  sourcesQueryErrorAtom,
  sourcesQueryFetchNextPageAtom,
  sourcesQueryHasDataAtom,
  sourcesQueryHasNextPageAtom,
  sourcesQueryIsFetchingAtom,
  sourcesQueryIsFetchingNextPageAtom,
  sourcesQueryIsFetchNextPageErrorAtom,
  sourcesQueryPageCountAtom,
  sourcesQueryRefetchAtom,
  taskPermissionDeniedAtom,
  tasksQueryErrorAtom,
  tasksQueryHasDataAtom,
  tasksQueryIsFetchingAtom,
  tasksQueryRefetchAtom,
} from './queries'
import {
  filterActiveAtom,
  sourceQueryWarningAtom,
  taskQueryWarningAtom,
  unresolvedDocumentSourceIdsAtom,
  unresolvedTaskDocumentIdsAtom,
} from './results'
import { documentDependencyRetryRequestAtom, documentTasksOpenAtom } from './scoped'

export const documentQueryRecoveryNoticeFactsAtom = atom((get) => ({
  error: get(documentsQueryErrorAtom),
  hasData: get(documentsQueryHasDataAtom),
  isFetchNextPageError: get(documentsQueryIsFetchNextPageErrorAtom),
  isRefetching: get(documentsQueryIsRefetchingAtom),
}))

export const documentCollectionFactsAtom = atom((get) => ({
  error: get(documentsQueryErrorAtom),
  hasData: get(documentsQueryHasDataAtom),
  isFetching: get(documentsQueryIsFetchingAtom),
  isPending: get(documentsQueryIsPendingAtom),
}))

export const dependencyRecoveryFactsAtom = atom((get) => {
  const retryRequest = get(documentDependencyRetryRequestAtom)
  const sourceError = get(sourcesQueryErrorAtom)
  const sourceHasData = get(sourcesQueryHasDataAtom)
  const sourceIsFetching = get(sourcesQueryIsFetchingAtom)
  const sourceIsFetchNextPageError = get(sourcesQueryIsFetchNextPageErrorAtom)
  const sourceWarning = get(sourceQueryWarningAtom)
  const taskError = get(tasksQueryErrorAtom)
  const taskHasData = get(tasksQueryHasDataAtom)
  const taskIsFetching = get(tasksQueryIsFetchingAtom)
  const taskWarning = get(taskQueryWarningAtom)
  const taskBlocking = Boolean(!taskHasData && (taskError || retryRequest.tasks))
  const sourceBlocking = Boolean(!sourceHasData && (sourceError || retryRequest.sources))
  const blocking = taskBlocking || sourceBlocking
  const warning = Boolean(
    (taskError && taskHasData) || (sourceError && sourceHasData) || sourceIsFetchNextPageError,
  )

  return {
    blocking,
    retryFetching: blocking
      ? Boolean((taskBlocking && taskIsFetching) || (sourceBlocking && sourceIsFetching))
      : Boolean((taskWarning && taskIsFetching) || (sourceWarning && sourceIsFetching)),
    sourceBlocking,
    sourceError,
    sourceIsFetchNextPageError,
    sourceWarning,
    taskBlocking,
    taskError,
    taskWarning,
    warning,
  }
})

export const retryDocumentDependenciesAtom = atom(null, (get, set) => {
  const recovery = get(dependencyRecoveryFactsAtom)
  if (recovery.blocking)
    set(documentDependencyRetryRequestAtom, (current) => ({
      sources: current.sources || recovery.sourceBlocking,
      tasks: current.tasks || recovery.taskBlocking,
    }))
  if (recovery.taskError || recovery.taskBlocking) void get(tasksQueryRefetchAtom)()
  if (recovery.sourceIsFetchNextPageError) void get(sourcesQueryFetchNextPageAtom)()
  else if (recovery.sourceError || recovery.sourceBlocking) void get(sourcesQueryRefetchAtom)()
})

export const resultsAutoPaginationFactsAtom = atom((get) => {
  const hasRelevantNextSourcePage = Boolean(
    get(sourcesQueryHasNextPageAtom) && get(unresolvedDocumentSourceIdsAtom).size,
  )

  return {
    shouldFetchDocuments: Boolean(
      (get(filterActiveAtom) ||
        (get(documentTasksOpenAtom) && get(unresolvedTaskDocumentIdsAtom).size > 0)) &&
      get(documentsQueryHasNextPageAtom) &&
      get(documentsQueryPageCountAtom) < MAX_AUTO_CURSOR_PAGES &&
      !get(documentsQueryIsFetchingNextPageAtom) &&
      !get(documentsQueryIsFetchNextPageErrorAtom),
    ),
    shouldFetchSources: Boolean(
      hasRelevantNextSourcePage &&
      get(sourcesQueryPageCountAtom) < MAX_AUTO_CURSOR_PAGES &&
      !get(sourcesQueryIsFetchingNextPageAtom) &&
      !get(sourcesQueryIsFetchNextPageErrorAtom),
    ),
  }
})

export const documentPermissionQueryFactsAtom = atom((get) => ({
  documentPermissionDenied: get(documentPermissionDeniedAtom),
  refetchDocuments: get(documentsQueryRefetchAtom),
  refetchSources: get(sourcesQueryRefetchAtom),
  refetchTasks: get(tasksQueryRefetchAtom),
  sourcePermissionDenied: get(sourcePermissionDeniedAtom),
  taskPermissionDenied: get(taskPermissionDeniedAtom),
}))

export const documentTaskPermissionGuardFactsAtom = atom((get) => ({
  documentPermissionDenied: get(documentPermissionDeniedAtom),
  refetchDocuments: get(documentsQueryRefetchAtom),
  sourcePermissionDenied: get(sourcePermissionDeniedAtom),
}))
