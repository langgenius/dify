import { skipToken } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

export function documentChunksQueryOptions({
  documentId,
  effectiveRevision,
  knowledgeSpaceId,
}: {
  documentId: string
  effectiveRevision: number
  knowledgeSpaceId: string
}) {
  const chunksQuery =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.byRevision
      .chunks

  return chunksQuery.get.infiniteOptions({
    input: (pageParam) => ({
      params: {
        control_space_id: knowledgeSpaceId,
        document_id: documentId,
        revision: effectiveRevision,
      },
      query: {
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
      },
    }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: null as string | null,
  })
}

export function documentOutlineQueryOptions({
  documentAssetId,
  knowledgeSpaceId,
}: {
  documentAssetId?: string
  knowledgeSpaceId: string
}) {
  const outlineQuery =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.outline

  return outlineQuery.get.queryOptions({
    context: { silent: true },
    input: documentAssetId
      ? {
          params: {
            control_space_id: knowledgeSpaceId,
            document_id: documentAssetId,
          },
        }
      : skipToken,
    retry: false,
  })
}

export function documentMultimodalQueryOptions({
  documentAssetId,
  knowledgeSpaceId,
}: {
  documentAssetId?: string
  knowledgeSpaceId: string
}) {
  const multimodalQuery =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.multimodal

  return multimodalQuery.get.queryOptions({
    context: { silent: true },
    input: documentAssetId
      ? {
          params: {
            control_space_id: knowledgeSpaceId,
            document_id: documentAssetId,
          },
        }
      : skipToken,
    retry: false,
  })
}
