import type { SnippetWorkflow } from '@/types/snippet'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

type WorkflowRunsParams = {
  last_id?: string
  limit?: number
}

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
    queryFn: async (context) => {
      try {
        const draftWorkflow = await queryOptions.queryFn(context)
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

export const useSnippetDraftConfig = (snippetId: string) => {
  return useQuery(consoleQuery.snippets.draftConfig.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  }))
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
      const publishedWorkflow = await queryOptions.queryFn(context)
      onSuccess?.(publishedWorkflow)
      return publishedWorkflow
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

export const useSnippetWorkflowRuns = (snippetId: string, params: WorkflowRunsParams = {}) => {
  return useQuery(consoleQuery.snippets.workflowRuns.queryOptions({
    input: {
      params: { snippetId },
      query: params,
    },
    enabled: !!snippetId,
  }))
}

export const useSnippetWorkflowRunDetail = (snippetId: string, runId: string) => {
  return useQuery(consoleQuery.snippets.workflowRunDetail.queryOptions({
    input: {
      params: {
        snippetId,
        runId,
      },
    },
    enabled: !!snippetId && !!runId,
  }))
}

export const useSnippetWorkflowRunNodeExecutions = (snippetId: string, runId: string) => {
  return useQuery(consoleQuery.snippets.workflowRunNodeExecutions.queryOptions({
    input: {
      params: {
        snippetId,
        runId,
      },
    },
    enabled: !!snippetId && !!runId,
  }))
}

export const useSnippetDraftNodeLastRun = (snippetId: string, nodeId: string, enabled = true) => {
  return useQuery(consoleQuery.snippets.lastDraftNodeRun.queryOptions({
    input: {
      params: {
        snippetId,
        nodeId,
      },
    },
    enabled: !!snippetId && !!nodeId && enabled,
    retry: 0,
  }))
}

export const useSyncSnippetDraftWorkflowMutation = (snippetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.snippets.syncDraftWorkflow.mutationOptions({
      onSuccess: async () => {
        await invalidateSnippetWorkflowQueries(queryClient, snippetId)
      },
    }),
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

export const useRunSnippetDraftNodeMutation = () => {
  return useMutation(consoleQuery.snippets.runDraftNode.mutationOptions())
}

export const useRunSnippetDraftIterationNodeMutation = () => {
  return useMutation(consoleQuery.snippets.runDraftIterationNode.mutationOptions())
}

export const useRunSnippetDraftLoopNodeMutation = () => {
  return useMutation(consoleQuery.snippets.runDraftLoopNode.mutationOptions())
}

export const useRunSnippetDraftWorkflowMutation = () => {
  return useMutation(consoleQuery.snippets.runDraftWorkflow.mutationOptions())
}

export const useStopSnippetWorkflowTaskMutation = (snippetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.snippets.stopWorkflowTask.mutationOptions({
      onSuccess: async () => {
        await invalidateSnippetWorkflowQueries(queryClient, snippetId)
      },
    }),
  })
}
