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
  tasksQueryFetchNextPageAtom,
  tasksQueryIsFetchingAtom,
  tasksQueryIsFetchNextPageErrorAtom,
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
  const taskIsFetchNextPageError = get(tasksQueryIsFetchNextPageErrorAtom)
  const taskIsFetching = get(tasksQueryIsFetchingAtom)
  const taskWarning = get(taskQueryWarningAtom)
  const sourceBlocking = Boolean(!sourceHasData && (sourceError || retryRequest.sources))
  const blocking = sourceBlocking
  const warning = taskWarning || sourceWarning

  return {
    blocking,
    retryFetching: blocking
      ? sourceIsFetching
      : Boolean((taskWarning && taskIsFetching) || (sourceWarning && sourceIsFetching)),
    sourceBlocking,
    sourceError,
    sourceIsFetchNextPageError,
    sourceWarning,
    taskError,
    taskIsFetchNextPageError,
    taskWarning,
    warning,
  }
})

export const retryDocumentDependenciesAtom = atom(null, (get, set) => {
  const recovery = get(dependencyRecoveryFactsAtom)
  if (recovery.blocking)
    set(documentDependencyRetryRequestAtom, (current) => ({
      sources: current.sources || recovery.sourceBlocking,
    }))
  if (recovery.taskIsFetchNextPageError) void get(tasksQueryFetchNextPageAtom)()
  else if (recovery.taskError) void get(tasksQueryRefetchAtom)()
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
