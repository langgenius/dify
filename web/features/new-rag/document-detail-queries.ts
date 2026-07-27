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
