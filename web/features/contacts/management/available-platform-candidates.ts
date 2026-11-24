import type { QueryClient } from '@tanstack/react-query'
import { infiniteQueryOptions } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function availablePlatformCandidatesOptions(
  queryClient: QueryClient,
  workspaceId: string,
  keyword: string,
) {
  const api = consoleQuery.workspaces.current.humanInput.v2
  const query = { keyword: keyword.trim() || undefined, page: 1, limit: 100 }
  return infiniteQueryOptions({
    queryKey: [
      ...api.organizationCandidates.get.queryKey({ input: { query } }),
      { workspaceId, view: 'available-contacts' },
    ],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      let page = pageParam
      let finalPage: number | undefined
      while (true) {
        signal.throwIfAborted()
        const candidateInput = { query: { ...query, page } }
        const response = await queryClient.query(
          api.organizationCandidates.get.queryOptions({
            input: candidateInput,
            queryKey: [
              ...api.organizationCandidates.get.queryKey({ input: candidateInput }),
              { workspaceId },
            ],
            context: { silent: true },
            staleTime: 30_000,
          }),
        )
        signal.throwIfAborted()
        if (response.page !== page || response.limit <= 0)
          throw new Error('Invalid organization candidate pagination')
        finalPage ??= Math.ceil(response.total / response.limit)
        const nextPage = response.page + 1
        const hasMore = response.page * response.limit < response.total
        if (hasMore && (!response.data.length || nextPage > finalPage))
          throw new Error('Organization candidate pagination did not advance')
        const batchInput = {
          query: { contact_ids: response.data.map((candidate) => candidate.id) },
        }
        const existing = response.data.length
          ? await queryClient.query(
              api.contacts.batch.get.queryOptions({
                input: batchInput,
                queryKey: [
                  ...api.contacts.batch.get.queryKey({ input: batchInput }),
                  { workspaceId },
                ],
                context: { silent: true },
                staleTime: 30_000,
              }),
            )
          : undefined
        signal.throwIfAborted()
        const existingIds = new Set(existing?.data.map((contact) => contact.id))
        const data = response.data.filter((candidate) => !existingIds.has(candidate.id))
        if (data.length || !hasMore) return { ...response, data }
        page = nextPage
      }
    },
    getNextPageParam: (page) => (page.page * page.limit < page.total ? page.page + 1 : undefined),
  })
}
