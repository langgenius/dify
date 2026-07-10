import type { PublishSnippetWorkflowResponse, SnippetWorkflow } from '@/types/snippet'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

const isNotFoundError = (error: unknown) => {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 404
}

export const fetchSnippetDraftWorkflow = async (snippetId: string) => {
  try {
    return await consoleClient.snippets.bySnippetId.workflows.draft.get({
      params: { snippet_id: snippetId },
    }, {
      context: { silent: true },
    })
  }
  catch (error) {
    if (isNotFoundError(error))
      return undefined

    throw error
  }
}

const snippetWorkflowContract = consoleQuery.snippets.bySnippetId
const snippetWorkflowClient = consoleClient.snippets.bySnippetId

const invalidateSnippetWorkflowQueries = async (
  queryClient: ReturnType<typeof useQueryClient>,
  snippetId: string,
) => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: snippetWorkflowContract.workflows.draft.get.key({
        type: 'query',
        input: {
          params: { snippet_id: snippetId },
        },
      }),
    }),
    queryClient.invalidateQueries({
      queryKey: snippetWorkflowContract.workflows.publish.get.key({
        type: 'query',
        input: {
          params: { snippet_id: snippetId },
        },
      }),
    }),
    queryClient.invalidateQueries({
      queryKey: snippetWorkflowContract.workflowRuns.get.key({ type: 'query' }),
    }),
    queryClient.invalidateQueries({
      queryKey: snippetWorkflowContract.workflows.draft.nodes.byNodeId.lastRun.get.key({ type: 'query' }),
    }),
  ])
}
export const useSnippetPublishedWorkflow = (
  snippetId: string,
  onSuccess?: (publishedWorkflow: SnippetWorkflow) => void,
) => {
  const queryOptions = snippetWorkflowContract.workflows.publish.get.queryOptions({
    input: {
      params: { snippet_id: snippetId },
    },
    enabled: !!snippetId,
  })

  return useQuery({
    ...queryOptions,
    queryFn: async (context) => {
      try {
        const publishedWorkflow = await queryOptions.queryFn(context)
        if (publishedWorkflow)
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
  const queryOptions = snippetWorkflowContract.workflows.defaultWorkflowBlockConfigs.get.queryOptions({
    input: {
      params: { snippet_id: snippetId },
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

  return useMutation<PublishSnippetWorkflowResponse, Error, { params: { snippetId: string } }>({
    mutationKey: snippetWorkflowContract.workflows.publish.post.mutationKey(),
    mutationFn: ({ params }) => snippetWorkflowClient.workflows.publish.post({
      params: {
        snippet_id: params.snippetId,
      },
      body: {},
    }),
    onSuccess: async () => {
      await invalidateSnippetWorkflowQueries(queryClient, snippetId)
    },
  })
}
