import { atom } from 'jotai'
import { atomWithInfiniteQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { sourceFromApi } from '../../sources/source-models'
import {
  backgroundTaskListFromApi,
  documentTaskListFromApi,
  logicalDocumentListFromApi,
} from '../models'
import {
  documentSourcesInfiniteOptions,
  documentTasksInfiniteOptions,
  logicalDocumentsInfiniteOptions,
} from '../queries'
import { responseStatus } from '../request-error'
import { documentsKnowledgeSpaceIdAtom } from './inputs'

const documentsQueryAtom = atomWithInfiniteQuery((get) =>
  logicalDocumentsInfiniteOptions(get(documentsKnowledgeSpaceIdAtom)),
)

const documentsQueryDataAtom = selectAtom(documentsQueryAtom, (query) => query.data)

export const documentsQueryHasDataAtom = atom((get) => Boolean(get(documentsQueryDataAtom)))
export const documentsQueryPageCountAtom = atom(
  (get) => get(documentsQueryDataAtom)?.pages.length ?? 0,
)

export const documentsAtom = atom(
  (get) =>
    get(documentsQueryDataAtom)?.pages.flatMap((page) => logicalDocumentListFromApi(page).items) ??
    [],
)

export const documentsByIdAtom = atom(
  (get) => new Map(get(documentsAtom).map((document) => [document.id, document])),
)

export const documentIdsAtom = atom(
  (get) => new Set(get(documentsAtom).map((document) => document.id)),
)

export const documentsQueryErrorAtom = selectAtom(documentsQueryAtom, (query) => query.error)
export const documentsQueryFetchNextPageAtom = selectAtom(
  documentsQueryAtom,
  (query) => query.fetchNextPage,
)
export const documentsQueryHasNextPageAtom = selectAtom(
  documentsQueryAtom,
  (query) => query.hasNextPage,
)
export const documentsQueryIsFetchNextPageErrorAtom = selectAtom(
  documentsQueryAtom,
  (query) => query.isFetchNextPageError,
)
export const documentsQueryIsFetchingAtom = selectAtom(
  documentsQueryAtom,
  (query) => query.isFetching,
)
export const documentsQueryIsFetchingNextPageAtom = selectAtom(
  documentsQueryAtom,
  (query) => query.isFetchingNextPage,
)
export const documentsQueryIsPendingAtom = selectAtom(
  documentsQueryAtom,
  (query) => query.isPending,
)
export const documentsQueryIsRefetchingAtom = selectAtom(
  documentsQueryAtom,
  (query) => query.isRefetching,
)
export const documentsQueryRefetchAtom = selectAtom(documentsQueryAtom, (query) => query.refetch)

export const documentPermissionDeniedAtom = atom(
  (get) => responseStatus(get(documentsQueryErrorAtom)) === 403,
)

const sourcesQueryAtom = atomWithInfiniteQuery((get) =>
  documentSourcesInfiniteOptions(get(documentsKnowledgeSpaceIdAtom), {
    enabled: !get(documentPermissionDeniedAtom),
  }),
)

const sourcesQueryDataAtom = selectAtom(sourcesQueryAtom, (query) => query.data)
export const sourcesQueryHasDataAtom = atom((get) => Boolean(get(sourcesQueryDataAtom)))
export const sourcesQueryPageCountAtom = atom((get) => get(sourcesQueryDataAtom)?.pages.length ?? 0)
const sourcesAtom = atom(
  (get) =>
    get(sourcesQueryDataAtom)?.pages.flatMap((page) =>
      page.data.map((source) => sourceFromApi(source)),
    ) ?? [],
)

export const sourceNamesAtom = atom(
  (get) => new Map(get(sourcesAtom).map((source) => [source.id, source.name])),
)

export const sourcesQueryErrorAtom = selectAtom(sourcesQueryAtom, (query) => query.error)
export const sourcesQueryFetchNextPageAtom = selectAtom(
  sourcesQueryAtom,
  (query) => query.fetchNextPage,
)
export const sourcesQueryHasNextPageAtom = selectAtom(
  sourcesQueryAtom,
  (query) => query.hasNextPage,
)
export const sourcesQueryIsFetchNextPageErrorAtom = selectAtom(
  sourcesQueryAtom,
  (query) => query.isFetchNextPageError,
)
export const sourcesQueryIsFetchingAtom = selectAtom(sourcesQueryAtom, (query) => query.isFetching)
export const sourcesQueryIsFetchingNextPageAtom = selectAtom(
  sourcesQueryAtom,
  (query) => query.isFetchingNextPage,
)
export const sourcesQueryIsPendingAtom = selectAtom(sourcesQueryAtom, (query) => query.isPending)
export const sourcesQueryRefetchAtom = selectAtom(sourcesQueryAtom, (query) => query.refetch)

export const sourcePermissionDeniedAtom = atom(
  (get) => responseStatus(get(sourcesQueryErrorAtom)) === 403,
)

export const tasksQueryAtom = atomWithInfiniteQuery((get) =>
  documentTasksInfiniteOptions(get(documentsKnowledgeSpaceIdAtom), {
    enabled: !get(documentPermissionDeniedAtom),
  }),
)

const tasksQueryDataAtom = selectAtom(tasksQueryAtom, (query) => query.data)

export const baseTasksAtom = atom(
  (get) =>
    get(tasksQueryDataAtom)?.pages.flatMap((page) => documentTaskListFromApi(page).items) ?? [],
)

export const backgroundTasksAtom = atom(
  (get) =>
    get(tasksQueryDataAtom)?.pages.flatMap((page) => backgroundTaskListFromApi(page).items) ?? [],
)

export const tasksQueryErrorAtom = selectAtom(tasksQueryAtom, (query) => query.error)
export const taskPermissionDeniedAtom = atom(
  (get) => responseStatus(get(tasksQueryErrorAtom)) === 403,
)
export const tasksQueryFetchNextPageAtom = selectAtom(
  tasksQueryAtom,
  (query) => query.fetchNextPage,
)
export const tasksQueryHasDataAtom = atom((get) => Boolean(get(tasksQueryDataAtom)))
export const tasksQueryHasNextPageAtom = selectAtom(tasksQueryAtom, (query) => query.hasNextPage)
export const tasksQueryIsFetchNextPageErrorAtom = selectAtom(
  tasksQueryAtom,
  (query) => query.isFetchNextPageError,
)
export const tasksQueryIsFetchingAtom = selectAtom(tasksQueryAtom, (query) => query.isFetching)
export const tasksQueryIsFetchingNextPageAtom = selectAtom(
  tasksQueryAtom,
  (query) => query.isFetchingNextPage,
)
export const tasksQueryIsPendingAtom = selectAtom(tasksQueryAtom, (query) => query.isPending)
export const tasksQueryPageCountAtom = atom((get) => get(tasksQueryDataAtom)?.pages.length ?? 0)
export const tasksQueryRefetchAtom = selectAtom(tasksQueryAtom, (query) => query.refetch)
