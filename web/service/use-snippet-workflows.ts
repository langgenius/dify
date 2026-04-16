import type { SnippetWorkflow } from '@/types/snippet'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import { get } from './base'

const isNotFoundError = (error: unknown) => {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 404
}

const invalidateSnippetWorkflowQueries = async (
  queryClient: ReturnType<typeof useQueryClient>,
  snippetId: string,
) => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: consoleQuery.snippets.draftWorkflow.queryKey({
        input: {
          params: { snippetId },
        },
      }),
    }),
    queryClient.invalidateQueries({
      queryKey: consoleQuery.snippets.publishedWorkflow.queryKey({
        input: {
          params: { snippetId },
        },
      }),
    }),
    queryClient.invalidateQueries({
      queryKey: consoleQuery.snippets.workflowRuns.key(),
    }),
    queryClient.invalidateQueries({
      queryKey: consoleQuery.snippets.lastDraftNodeRun.key(),
    }),
  ])
}

export const useSnippetDraftWorkflow = (
  snippetId: string,
  onSuccess?: (draftWorkflow: SnippetWorkflow) => void,
) => {
  const queryOptions = consoleQuery.snippets.draftWorkflow.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  })

  return useQuery({
    ...queryOptions,
    queryFn: async () => {
      try {
        const draftWorkflow = await get<SnippetWorkflow>(`/snippets/${snippetId}/workflows/draft`, {}, { silent: true })
        onSuccess?.(draftWorkflow)
        return draftWorkflow
      }
      catch (error) {
        if (isNotFoundError(error))
          return undefined

        throw error
      }
    },
  })
}

export const useSnippetPublishedWorkflow = (
  snippetId: string,
  onSuccess?: (publishedWorkflow: SnippetWorkflow) => void,
) => {
  const queryOptions = consoleQuery.snippets.publishedWorkflow.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  })

  return useQuery({
    ...queryOptions,
    queryFn: async (context) => {
      try {
        const publishedWorkflow = await queryOptions.queryFn(context)
        onSuccess?.(publishedWorkflow)
        return publishedWorkflow
      }
      catch (error) {
        if (isNotFoundError(error))
          return undefined

        throw error
      }
    },
  })
}

export const useSnippetDefaultBlockConfigs = (
  snippetId: string,
  onSuccess?: (nodesDefaultConfigs: unknown) => void,
) => {
  const queryOptions = consoleQuery.snippets.defaultBlockConfigs.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  })

  return useQuery({
    ...queryOptions,
    queryFn: async (context) => {
      const nodesDefaultConfigs = await queryOptions.queryFn(context)
      onSuccess?.(nodesDefaultConfigs)
      return nodesDefaultConfigs
    },
  })
}

export const usePublishSnippetWorkflowMutation = (snippetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.snippets.publishWorkflow.mutationOptions({
      onSuccess: async () => {
        await invalidateSnippetWorkflowQueries(queryClient, snippetId)
      },
    }),
  })
}
