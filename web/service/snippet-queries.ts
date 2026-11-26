import { keepPreviousData } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'
import { isNotFoundError } from '@/service/http-error'

type SnippetListParams = {
  page?: number
  limit?: number
  keyword?: string
  tag_ids?: string[]
  creator_ids?: string[]
  is_published?: boolean
}

const DEFAULT_SNIPPET_LIST_PAGE = 1
const DEFAULT_SNIPPET_LIST_LIMIT = 30

export function snippetListInfiniteOptions(params: SnippetListParams = {}) {
  const initialPage = params.page ?? DEFAULT_SNIPPET_LIST_PAGE
  const query = {
    limit: params.limit ?? DEFAULT_SNIPPET_LIST_LIMIT,
    ...(params.keyword ? { keyword: params.keyword } : {}),
    ...(params.tag_ids?.length ? { tag_ids: params.tag_ids } : {}),
    ...(params.creator_ids?.length ? { creators: params.creator_ids } : {}),
    ...(typeof params.is_published === 'boolean' ? { is_published: params.is_published } : {}),
  }

  return consoleQuery.workspaces.current.customizedSnippets.get.infiniteOptions({
    input: (page: number) => ({ query: { ...query, page } }),
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    initialPageParam: initialPage,
    placeholderData: keepPreviousData,
  })
}

// A snippet that has never been published answers 404; treat that as "no published workflow".
export function snippetPublishedWorkflowQueryOptions(snippetId: string) {
  const options = consoleQuery.snippets.bySnippetId.workflows.publish.get.queryOptions({
    input: {
      params: { snippet_id: snippetId },
    },
    enabled: !!snippetId,
  })

  return {
    ...options,
    queryFn: async (context: Parameters<typeof options.queryFn>[0]) => {
      try {
        return await options.queryFn(context)
      } catch (error) {
        if (isNotFoundError(error)) return undefined

        throw error
      }
    },
  }
}

export const fetchSnippetDraftWorkflow = async (snippetId: string) => {
  try {
    return await consoleClient.snippets.bySnippetId.workflows.draft.get({
      params: { snippet_id: snippetId },
    })
  } catch (error) {
    if (isNotFoundError(error)) return undefined

    throw error
  }
}
