import type { GetKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunksResponse } from '@dify/contracts/knowledge-fs/types.gen'
import { infiniteQueryOptions } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

const CHUNK_PAGE_SIZE = 100

export function documentChunksQueryOptions({
  documentId,
  effectiveRevision,
  knowledgeSpaceId,
}: {
  documentId: string
  effectiveRevision?: number
  knowledgeSpaceId: string
}) {
  const chunksQuery =
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunks

  if (effectiveRevision === undefined) {
    return infiniteQueryOptions({
      enabled: false,
      queryFn:
        async (): Promise<GetKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunksResponse> => {
          throw new Error('Document revision is required to load chunks')
        },
      initialPageParam: null as string | null,
      getNextPageParam: () => undefined,
      queryKey: [...chunksQuery.key(), { documentId, knowledgeSpaceId, revision: null }],
    })
  }

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
