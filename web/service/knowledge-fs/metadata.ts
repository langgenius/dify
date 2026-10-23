import { consoleClient, consoleQuery } from '@/service/console/inferred'

type MetadataResponse = Awaited<
  ReturnType<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.get>
>
type KnowledgeFsMetadataFieldResponse = MetadataResponse['data'][number]

export type KnowledgeFsMetadataField = {
  count: number
  createdAt: string
  id: string
  name: string
  rowVersion: number
  type: 'string' | 'number' | 'time'
  updatedAt: string
}

function knowledgeFsMetadataFieldFromApi(
  field: KnowledgeFsMetadataFieldResponse,
): KnowledgeFsMetadataField {
  return {
    count: field.count,
    createdAt: field.created_at,
    id: field.id,
    name: field.name,
    rowVersion: field.row_version,
    type: field.type,
    updatedAt: field.updated_at,
  }
}

export function knowledgeFsMetadataFieldsQueryOptions(knowledgeSpaceId: string) {
  return {
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.metadata.get.queryOptions({
      context: { silent: true },
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { limit: 100 },
      },
      retry: false,
    }),
    queryFn: async ({ signal }: { signal?: AbortSignal } = {}) => {
      const data: KnowledgeFsMetadataFieldResponse[] = []
      const visitedCursors = new Set<string>()
      let cursor: string | undefined
      do {
        const response = await consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.get(
          {
            params: { control_space_id: knowledgeSpaceId },
            query: { ...(cursor ? { cursor } : {}), limit: 100 },
          },
          { signal, context: { silent: true } },
        )
        data.push(...response.data)
        const nextCursor = response.next_cursor ?? undefined
        if (!nextCursor || visitedCursors.has(nextCursor)) break
        visitedCursors.add(nextCursor)
        cursor = nextCursor
      } while (cursor)
      return { data }
    },
    select: (response: { data: KnowledgeFsMetadataFieldResponse[] }) =>
      response.data.map(knowledgeFsMetadataFieldFromApi),
    staleTime: 30_000,
  }
}
