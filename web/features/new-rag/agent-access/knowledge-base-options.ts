import { useInfiniteQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

const PAGE_SIZE = 100

export type KnowledgeBaseOption = {
  id: string
  name: string
  description: string | null
}

/** Knowledge bases the member can open in this workspace: what a connection may be granted. */
export function useKnowledgeBaseOptions(enabled = true) {
  const query = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (page) => ({ query: { limit: PAGE_SIZE, page } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
    enabled,
  })
  const options: KnowledgeBaseOption[] =
    query.data?.pages
      .flatMap((page) => page.data)
      .filter((space) => space.state === 'active' && space.knowledge_space_id)
      .map((space) => ({
        id: space.control_space_id,
        name: space.technical_summary?.name ?? space.control_space_id,
        description: space.technical_summary?.description ?? null,
      })) ?? []
  return { options, query }
}

/** Names for a connection's knowledge bases; ids outside the loaded options only count. */
export function knowledgeBaseSummary(
  ids: readonly string[],
  options: readonly KnowledgeBaseOption[],
) {
  const names = ids.flatMap((id) => options.find((option) => option.id === id)?.name ?? [])
  return { names: names.slice(0, 3), more: ids.length - Math.min(names.length, 3) }
}
