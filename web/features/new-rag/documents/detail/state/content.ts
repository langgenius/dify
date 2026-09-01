import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { documentChunkListFromApi } from '../../models'
import { buildDocumentDetailModel } from '../model'
import {
  documentDetailDocumentIdAtom,
  documentDetailKnowledgeSpaceIdAtom,
  documentDetailRequestedChunkIdAtom,
} from './inputs'
import { documentDetailDocumentAtom } from './queries'
import { documentDetailEffectiveRevisionAtom, documentDetailRevisionAtom } from './revisions'

const documentChunksQueryAtom = atomWithInfiniteQuery((get) => {
  const effectiveRevision = get(documentDetailEffectiveRevisionAtom)
  if (effectiveRevision === undefined)
    throw new Error('Document revision is unavailable for chunk loading')

  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.byRevision.chunks.get.infiniteOptions(
    {
      input: (pageParam) => ({
        params: {
          control_space_id: get(documentDetailKnowledgeSpaceIdAtom),
          document_id: get(documentDetailDocumentIdAtom),
          revision: effectiveRevision,
        },
        query: {
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
    },
  )
})

const documentChunksQueryDataAtom = selectAtom(documentChunksQueryAtom, (query) => query.data)

export const documentChunksQueryErrorAtom = selectAtom(
  documentChunksQueryAtom,
  (query) => query.error,
)
export const documentChunksQueryHasDataAtom = atom((get) =>
  Boolean(get(documentChunksQueryDataAtom)),
)
export const documentChunksQueryHasNextPageAtom = selectAtom(
  documentChunksQueryAtom,
  (query) => query.hasNextPage,
)
export const documentChunksQueryIsFetchNextPageErrorAtom = selectAtom(
  documentChunksQueryAtom,
  (query) => query.isFetchNextPageError,
)
export const documentChunksQueryIsFetchingNextPageAtom = selectAtom(
  documentChunksQueryAtom,
  (query) => query.isFetchingNextPage,
)
export const documentChunksQueryIsPendingAtom = selectAtom(
  documentChunksQueryAtom,
  (query) => query.isPending,
)

export const documentDetailChunksAtom = atom((get) =>
  [
    ...(get(documentChunksQueryDataAtom)?.pages.flatMap(
      (page) => documentChunkListFromApi(page).items,
    ) ?? []),
  ].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)),
)

const documentDetailAssetAtom = atom((get) => {
  const document = get(documentDetailDocumentAtom)
  const effectiveRevision = get(documentDetailEffectiveRevisionAtom)
  return (
    get(documentDetailRevisionAtom) ??
    (document.active?.revision === effectiveRevision ? document.active : undefined)
  )
})

const documentOutlineQueryAtom = atomWithQuery((get) => {
  const documentAssetId = get(documentDetailAssetAtom)?.documentAssetId
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.outline.get.queryOptions(
    {
      context: { silent: true },
      input: documentAssetId
        ? {
            params: {
              control_space_id: get(documentDetailKnowledgeSpaceIdAtom),
              document_id: documentAssetId,
            },
          }
        : skipToken,
      retry: false,
    },
  )
})

const documentMultimodalQueryAtom = atomWithQuery((get) => {
  const documentAssetId = get(documentDetailAssetAtom)?.documentAssetId
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.multimodal.get.queryOptions(
    {
      context: { silent: true },
      input: documentAssetId
        ? {
            params: {
              control_space_id: get(documentDetailKnowledgeSpaceIdAtom),
              document_id: documentAssetId,
            },
          }
        : skipToken,
      retry: false,
    },
  )
})

const documentOutlineDataAtom = selectAtom(documentOutlineQueryAtom, (query) => query.data)
const documentMultimodalDataAtom = selectAtom(documentMultimodalQueryAtom, (query) => query.data)

export const documentDetailMultimodalItemsAtom = atom((get) => {
  const manifest = get(documentMultimodalDataAtom)
  if (!manifest || manifest.version !== get(documentDetailAssetAtom)?.documentAssetVersion)
    return []
  return manifest.items ?? []
})

export const documentDetailModelAtom = atom((get) => {
  const documentAssetVersion = get(documentDetailAssetAtom)?.documentAssetVersion
  const outline = get(documentOutlineDataAtom)
  return buildDocumentDetailModel(
    get(documentDetailChunksAtom),
    outline && outline.version === documentAssetVersion ? outline.nodes : [],
    get(documentDetailMultimodalItemsAtom),
  )
})

export const documentDetailSelectedChunkKnownAtom = atom((get) => {
  const selectedChunkId = get(documentDetailRequestedChunkIdAtom)
  return selectedChunkId
    ? get(documentDetailModelAtom).sourceChunksById.has(selectedChunkId)
    : false
})

export const documentDetailSelectedBlockAtom = atom((get) => {
  const selectedChunkId = get(documentDetailRequestedChunkIdAtom)
  const detailModel = get(documentDetailModelAtom)
  const targetedBlock = selectedChunkId
    ? detailModel.contentBlocksByChunkId.get(selectedChunkId)
    : undefined
  const targetLookupComplete =
    !selectedChunkId ||
    get(documentDetailSelectedChunkKnownAtom) ||
    (!get(documentChunksQueryIsPendingAtom) &&
      (!get(documentChunksQueryHasNextPageAtom) ||
        get(documentChunksQueryIsFetchNextPageErrorAtom)))
  const firstRoot = detailModel.tree.roots[0]
  const fallbackBlock = firstRoot
    ? detailModel.contentBlocksByChunkId.get(firstRoot.targetChunkId)
    : undefined
  return targetedBlock ?? (targetLookupComplete ? fallbackBlock : undefined)
})

export const documentDetailSelectedChunkIdAtom = atom(
  (get) => get(documentDetailSelectedBlockAtom)?.chunk.id,
)

export const documentDetailChunksCompleteAtom = atom(
  (get) =>
    get(documentChunksQueryHasDataAtom) &&
    !get(documentChunksQueryErrorAtom) &&
    !get(documentChunksQueryHasNextPageAtom) &&
    !get(documentChunksQueryIsFetchingNextPageAtom) &&
    !get(documentChunksQueryIsFetchNextPageErrorAtom),
)

export const loadNextDocumentChunkPageAtom = atom(null, (get) =>
  get(documentChunksQueryAtom).fetchNextPage(),
)

export const retryDocumentChunksAtom = atom(null, (get) => get(documentChunksQueryAtom).refetch())
