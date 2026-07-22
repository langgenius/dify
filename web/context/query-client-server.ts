import { MutationCache, QueryClient } from '@tanstack/react-query'
import { cache } from 'react'

const STALE_TIME = 1000 * 60 * 5 // 5 minutes
const KNOWLEDGE_FS_QUERY_PATH = ['console', 'knowledgeFs'] as const
const KNOWLEDGE_FS_QUERY_KEY = [KNOWLEDGE_FS_QUERY_PATH, {}] as const

function isKnowledgeFsMutationKey(mutationKey: readonly unknown[] | undefined) {
  const [path] = mutationKey ?? []
  return (
    Array.isArray(path) &&
    path.length > KNOWLEDGE_FS_QUERY_PATH.length &&
    KNOWLEDGE_FS_QUERY_PATH.every((segment, index) => path[index] === segment)
  )
}

export function makeQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _onMutateResult, mutation, context) => {
        if (!isKnowledgeFsMutationKey(mutation.options.mutationKey)) return

        return context.client.invalidateQueries({ queryKey: KNOWLEDGE_FS_QUERY_KEY })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
      },
    },
  })
}

export const getQueryClientServer = cache(makeQueryClient)
