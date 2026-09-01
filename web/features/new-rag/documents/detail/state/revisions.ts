import { atom } from 'jotai'
import { atomWithInfiniteQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { documentRevisionListFromApi } from '../../models'
import { initialDocumentRevision } from '../model'
import {
  documentDetailDocumentIdAtom,
  documentDetailKnowledgeSpaceIdAtom,
  documentDetailRequestedRevisionAtom,
} from './inputs'
import { documentDetailDocumentAtom } from './queries'

const documentRevisionsQueryAtom = atomWithInfiniteQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.get.infiniteOptions(
    {
      input: (pageParam) => ({
        params: {
          control_space_id: get(documentDetailKnowledgeSpaceIdAtom),
          document_id: get(documentDetailDocumentIdAtom),
        },
        query: {
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
    },
  ),
)

const documentRevisionsQueryDataAtom = selectAtom(documentRevisionsQueryAtom, (query) => query.data)

const documentRevisionsAtom = atom(
  (get) =>
    get(documentRevisionsQueryDataAtom)?.pages.flatMap(
      (page) => documentRevisionListFromApi(page).items,
    ) ?? [],
)

export const documentDetailAvailableRevisionsAtom = atom((get) => {
  const document = get(documentDetailDocumentAtom)
  const byRevision = new Map(
    get(documentRevisionsAtom).map((revision) => [revision.revision, revision]),
  )
  if (document.active) byRevision.set(document.active.revision, document.active)
  return [...byRevision.values()].sort((left, right) => right.revision - left.revision)
})

export const documentDetailRevisionAtom = atom((get) => {
  const document = get(documentDetailDocumentAtom)
  const availableRevisions = get(documentDetailAvailableRevisionsAtom)
  const requestedRevision =
    get(documentDetailRequestedRevisionAtom) ??
    initialDocumentRevision(document, availableRevisions)
  return availableRevisions.find((candidate) => candidate.revision === requestedRevision)
})

export const documentDetailEffectiveRevisionAtom = atom(
  (get) => get(documentDetailRevisionAtom)?.revision,
)

export const documentDetailRevisionSessionKeyAtom = atom((get) => {
  const effectiveRevision = get(documentDetailEffectiveRevisionAtom)
  if (effectiveRevision === undefined) return undefined
  return `${get(documentDetailDocumentIdAtom)}:${effectiveRevision}`
})

export const documentRevisionsQueryErrorAtom = selectAtom(
  documentRevisionsQueryAtom,
  (query) => query.error,
)
export const documentRevisionsQueryHasNextPageAtom = selectAtom(
  documentRevisionsQueryAtom,
  (query) => query.hasNextPage,
)
export const documentRevisionsQueryIsFetchNextPageErrorAtom = selectAtom(
  documentRevisionsQueryAtom,
  (query) => query.isFetchNextPageError,
)
export const documentRevisionsQueryIsFetchingNextPageAtom = selectAtom(
  documentRevisionsQueryAtom,
  (query) => query.isFetchingNextPage,
)
export const documentRevisionsQueryIsPendingAtom = selectAtom(
  documentRevisionsQueryAtom,
  (query) => query.isPending,
)

export const loadNextDocumentRevisionPageAtom = atom(null, (get) =>
  get(documentRevisionsQueryAtom).fetchNextPage(),
)

export const retryDocumentRevisionsAtom = atom(null, (get) => {
  const query = get(documentRevisionsQueryAtom)
  if (query.isFetchNextPageError) return query.fetchNextPage()
  return query.refetch()
})
