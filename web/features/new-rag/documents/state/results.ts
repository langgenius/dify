import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { knowledgeFsTaskFailureMessageKey } from '../../knowledge-fs-task-error'
import { documentDisplayStatus, sourceName, taskNeedsAttention } from '../model'
import { MAX_AUTO_CURSOR_PAGES } from '../tasks/recovery'
import { activeTasksAtom, documentTaskByDocumentAtom, drawerTasksAtom } from '../tasks/state'
import { documentFilterAtom, documentSearchAtom } from './inputs'
import {
  baseTasksAtom,
  documentIdsAtom,
  documentsAtom,
  documentsByIdAtom,
  documentsQueryErrorAtom,
  documentsQueryHasDataAtom,
  documentsQueryHasNextPageAtom,
  documentsQueryIsFetchingNextPageAtom,
  documentsQueryIsFetchNextPageErrorAtom,
  documentsQueryPageCountAtom,
  sourceNamesAtom,
  sourcesQueryErrorAtom,
  sourcesQueryHasDataAtom,
  sourcesQueryHasNextPageAtom,
  sourcesQueryIsFetchingNextPageAtom,
  sourcesQueryIsFetchNextPageErrorAtom,
  sourcesQueryIsPendingAtom,
  tasksQueryErrorAtom,
  tasksQueryHasDataAtom,
  tasksQueryHasNextPageAtom,
  tasksQueryIsFetchNextPageErrorAtom,
} from './queries'
import { documentCanWriteAtom } from './runtime'

export const unresolvedTaskDocumentIdsAtom = atom((get) => {
  const documentIds = get(documentIdsAtom)

  return new Set(
    get(baseTasksAtom).flatMap((task) =>
      !documentIds.has(task.documentId) ? [task.documentId] : [],
    ),
  )
})

export const unresolvedDocumentSourceIdsAtom = atom((get) => {
  const sourceNames = get(sourceNamesAtom)

  return new Set(
    get(documentsAtom).flatMap((document) =>
      document.sourceId && !sourceNames.has(document.sourceId) ? [document.sourceId] : [],
    ),
  )
})

export const documentStatusesAtom = atom((get) => {
  const taskByDocument = get(documentTaskByDocumentAtom)

  return new Map(
    get(documentsAtom).map((document) => [
      document.id,
      documentDisplayStatus(document, taskByDocument.get(document.id)),
    ]),
  )
})

const documentFailureMessageKeysAtom = atom((get) => {
  const statuses = get(documentStatusesAtom)
  const taskByDocument = get(documentTaskByDocumentAtom)

  return new Map(
    get(documentsAtom).flatMap((document) => {
      if (statuses.get(document.id) !== 'failed') return []
      const task = taskByDocument.get(document.id)
      const messageKey =
        knowledgeFsTaskFailureMessageKey(
          task?.failure,
          task?.errorCode ?? (task?.errorMessage ? 'LEGACY_TASK_FAILURE' : undefined),
        ) ?? 'taskFailure.internal'
      return [[document.id, messageKey] as const]
    }),
  )
})

export const filterActiveAtom = atom((get) => {
  return get(documentFilterAtom) !== 'all' || Boolean(get(documentSearchAtom).trim())
})

export const filteredDocumentsAtom = atom((get) => {
  const filter = get(documentFilterAtom)
  const normalizedSearch = get(documentSearchAtom).trim().toLocaleLowerCase()
  const sourceNames = get(sourceNamesAtom)
  const statuses = get(documentStatusesAtom)

  return get(documentsAtom).filter((document) => {
    if (filter !== 'all' && statuses.get(document.id) !== filter) return false
    if (!normalizedSearch) return true
    const resolvedSourceName =
      (document.sourceId && sourceNames.get(document.sourceId)) ?? sourceName(document)
    return `${document.title} ${resolvedSourceName ?? ''}`
      .toLocaleLowerCase()
      .includes(normalizedSearch)
  })
})

export const documentSnapshotPendingAtom = atom((get) => !get(documentsQueryHasDataAtom))

const sourceResultsIncompleteAtom = atom((get) => {
  return Boolean(
    !get(sourcesQueryHasDataAtom) ||
    get(sourcesQueryIsPendingAtom) ||
    (get(unresolvedDocumentSourceIdsAtom).size &&
      (get(sourcesQueryHasNextPageAtom) ||
        get(sourcesQueryErrorAtom) ||
        get(sourcesQueryIsFetchingNextPageAtom) ||
        get(sourcesQueryIsFetchNextPageErrorAtom))),
  )
})

const filteredCollectionResultsIncompleteAtom = atom((get) => {
  if (!get(filterActiveAtom)) return false

  return Boolean(
    get(documentsQueryHasNextPageAtom) ||
    get(documentsQueryIsFetchingNextPageAtom) ||
    get(documentsQueryIsFetchNextPageErrorAtom) ||
    (get(unresolvedDocumentSourceIdsAtom).size > 0 &&
      (get(sourcesQueryHasNextPageAtom) ||
        get(sourcesQueryIsFetchingNextPageAtom) ||
        get(sourcesQueryIsFetchNextPageErrorAtom))),
  )
})

export const filteredResultsIncompleteAtom = atom(
  (get) =>
    get(filteredCollectionResultsIncompleteAtom) ||
    (get(filterActiveAtom) && get(documentSnapshotPendingAtom)),
)

export const documentListPaginationAtom = atom((get) => {
  const filterActive = get(filterActiveAtom)
  const hasNextDocumentPage = Boolean(get(documentsQueryHasNextPageAtom))
  const isFetchingNextDocumentPage = get(documentsQueryIsFetchingNextPageAtom)
  const hasRelevantNextSourcePage = Boolean(
    get(sourcesQueryHasNextPageAtom) && get(unresolvedDocumentSourceIdsAtom).size,
  )
  const isFetchingNextSourcePage = get(sourcesQueryIsFetchingNextPageAtom)

  return {
    completingResults: Boolean(
      filterActive &&
      !get(documentsQueryIsFetchNextPageErrorAtom) &&
      ((hasNextDocumentPage && get(documentsQueryPageCountAtom) < MAX_AUTO_CURSOR_PAGES) ||
        isFetchingNextDocumentPage),
    ),
    filterActive,
    hasNextDocumentPage,
    hasNextPage: hasNextDocumentPage || hasRelevantNextSourcePage,
    hasRelevantNextSourcePage,
    isFetchingNextDocumentPage,
    isFetchingNextPage: Boolean(
      isFetchingNextDocumentPage || (hasRelevantNextSourcePage && isFetchingNextSourcePage),
    ),
    isFetchingNextSourcePage,
    isFetchNextPageError: get(documentsQueryIsFetchNextPageErrorAtom),
  }
})

const dependencyResultsIncompleteAtom = atom(
  (get) => get(documentSnapshotPendingAtom) || get(sourceResultsIncompleteAtom),
)

export const createDocumentRowSourceFactsAtom = (documentId: string) => {
  const factsAtom = atom((get) => {
    const document = get(documentsByIdAtom).get(documentId)
    const sourceNames = get(sourceNamesAtom)
    if (!document) return { pending: false, source: undefined }

    return {
      pending: Boolean(
        get(sourceResultsIncompleteAtom) &&
        document.sourceId &&
        !sourceNames.has(document.sourceId),
      ),
      source: (document.sourceId && sourceNames.get(document.sourceId)) ?? sourceName(document),
    }
  })
  return selectAtom(
    factsAtom,
    (facts) => facts,
    (left, right) => left.pending === right.pending && left.source === right.source,
  )
}

const createDocumentRowFactsAtom = (documentId: string) => {
  return atom((get) => {
    const document = get(documentsByIdAtom).get(documentId)
    const sourceNames = get(sourceNamesAtom)
    const documentSnapshotPending = get(documentSnapshotPendingAtom)

    return {
      failureMessageKey: get(documentFailureMessageKeysAtom).get(documentId),
      status: get(documentStatusesAtom).get(documentId) ?? ('queued' as const),
      statusPending: Boolean(
        documentSnapshotPending ||
        (get(dependencyResultsIncompleteAtom) &&
          document?.sourceId &&
          !sourceNames.has(document.sourceId)),
      ),
      task: get(documentTaskByDocumentAtom).get(documentId),
      documentSnapshotPending,
    }
  })
}

export const createDocumentRowStatusFactsAtom = (documentId: string) => {
  return selectAtom(
    createDocumentRowFactsAtom(documentId),
    ({ failureMessageKey, status, statusPending }) => ({
      failureMessageKey,
      status,
      statusPending,
    }),
    (left, right) =>
      left.failureMessageKey === right.failureMessageKey &&
      left.status === right.status &&
      left.statusPending === right.statusPending,
  )
}

export const createDocumentRowActionFactsAtom = (documentId: string) => {
  return selectAtom(
    createDocumentRowFactsAtom(documentId),
    ({ status, task, documentSnapshotPending }) => ({ status, task, documentSnapshotPending }),
    (left, right) =>
      left.status === right.status &&
      left.task === right.task &&
      left.documentSnapshotPending === right.documentSnapshotPending,
  )
}

const documentQueryWarningAtom = atom(
  (get) => Boolean(get(documentsQueryErrorAtom)) && get(documentsQueryHasDataAtom),
)

export const taskQueryWarningAtom = atom(
  (get) =>
    (Boolean(get(tasksQueryErrorAtom)) && get(tasksQueryHasDataAtom)) ||
    get(tasksQueryIsFetchNextPageErrorAtom),
)

export const sourceQueryWarningAtom = atom(
  (get) =>
    (Boolean(get(sourcesQueryErrorAtom)) && get(sourcesQueryHasDataAtom)) ||
    get(sourcesQueryIsFetchNextPageErrorAtom),
)

export const selectionResultsUnavailableAtom = atom((get) => {
  return Boolean(
    get(dependencyResultsIncompleteAtom) ||
    get(documentQueryWarningAtom) ||
    (get(sourceQueryWarningAtom) && get(unresolvedDocumentSourceIdsAtom).size > 0) ||
    get(filteredResultsIncompleteAtom),
  )
})

export const documentResultsUnavailableByIdAtom = atom((get) => {
  const unloaded = !get(documentsQueryHasDataAtom)
  const missingSources = get(unresolvedDocumentSourceIdsAtom)
  const sourcesIncomplete = get(sourceResultsIncompleteAtom)
  const refreshFailed = get(documentQueryWarningAtom)
  const filteredCollectionIncomplete = get(filteredCollectionResultsIncompleteAtom)
  return new Map(
    get(documentsAtom).map((document) => [
      document.id,
      Boolean(
        unloaded ||
        refreshFailed ||
        filteredCollectionIncomplete ||
        (document.sourceId && missingSources.has(document.sourceId) && sourcesIncomplete),
      ),
    ]),
  )
})

export const createDocumentRowResultsUnavailableAtom = (documentId: string) =>
  selectAtom(
    documentResultsUnavailableByIdAtom,
    (unavailable) => unavailable.get(documentId) ?? true,
  )

export const createDocumentRowCanEditAtom = (documentId: string) => {
  const unavailableAtom = createDocumentRowResultsUnavailableAtom(documentId)
  return atom((get) => get(documentCanWriteAtom) && !get(unavailableAtom))
}

export type ReindexUnavailability = 'documents' | 'loading' | 'partial' | 'sources' | undefined

export const reindexUnavailabilityAtom = atom<ReindexUnavailability>((get) => {
  if (
    (get(sourcesQueryErrorAtom) || get(sourcesQueryIsFetchNextPageErrorAtom)) &&
    get(unresolvedDocumentSourceIdsAtom).size > 0
  )
    return 'sources'
  if (get(documentsQueryErrorAtom) || get(documentsQueryIsFetchNextPageErrorAtom))
    return 'documents'
  if (get(dependencyResultsIncompleteAtom)) return 'loading'
  if (get(filteredResultsIncompleteAtom)) return 'partial'
})

const attentionTasksAtom = atom((get) => get(drawerTasksAtom).filter(taskNeedsAttention))
const activeTaskCountAtom = atom((get) => get(activeTasksAtom).length)
const hasTaskErrorAtom = atom((get) =>
  get(attentionTasksAtom).some((task) => task.state === 'failed' || task.state === 'canceled'),
)
const showTasksAtom = atom((get) => {
  return Boolean(
    get(drawerTasksAtom).length ||
    get(tasksQueryIsFetchNextPageErrorAtom) ||
    get(tasksQueryHasNextPageAtom),
  )
})

export const taskTriggerFactsAtom = atom((get) => ({
  activeTaskCount: get(activeTaskCountAtom),
  attentionTaskCount: get(attentionTasksAtom).length,
  hasTaskError: get(hasTaskErrorAtom),
  historyIncomplete: Boolean(get(tasksQueryHasNextPageAtom)),
}))

export const documentsToolbarFactsAtom = atom((get) => ({
  showTasks: get(showTasksAtom) || Boolean(get(tasksQueryErrorAtom)),
  statusPending: get(dependencyResultsIncompleteAtom),
}))

export const documentRenderWindowIdentityAtom = atom(
  (get) => `${get(documentFilterAtom)}:${get(documentSearchAtom)}`,
)

export const documentTableContentFactsAtom = atom((get) => ({
  documents: get(filteredDocumentsAtom),
  resultsIncomplete: get(filteredResultsIncompleteAtom),
  sourcesPending: get(sourceResultsIncompleteAtom),
  documentSnapshotPending: get(documentSnapshotPendingAtom),
}))
