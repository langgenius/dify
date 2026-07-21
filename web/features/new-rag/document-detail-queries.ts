import { skipToken } from '@tanstack/react-query'
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
  return consoleQuery.knowledgeFs.getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunks.infiniteOptions(
    {
      enabled: effectiveRevision !== undefined,
      input:
        effectiveRevision === undefined
          ? skipToken
          : (pageParam) => ({
              params: { documentId, id: knowledgeSpaceId, revision: effectiveRevision },
              query: {
                limit: CHUNK_PAGE_SIZE,
                ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
              },
            }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
    },
  )
}
