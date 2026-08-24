import { consoleQuery } from '@/service/client'

const CHUNK_PAGE_SIZE = 100

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
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunks

  return chunksQuery.infiniteOptions({
    input: (pageParam) => ({
      params: { documentId, id: knowledgeSpaceId, revision: effectiveRevision },
      query: {
        limit: CHUNK_PAGE_SIZE,
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
      },
    }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
  })
}
