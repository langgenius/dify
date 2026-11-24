import type { TagResponse, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function seedTags(queryClient: QueryClient, tags: TagResponse[]) {
  const types: TagType[] = ['app', 'agent', 'knowledge', 'snippet', 'skill']
  for (const type of types)
    queryClient.setQueryData(consoleQuery.tags.get.queryKey({ input: { query: { type } } }), tags)
}
