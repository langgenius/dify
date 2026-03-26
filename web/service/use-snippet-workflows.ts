import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

type WorkflowRunsParams = {
  last_id?: string
  limit?: number
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

export const useSnippetDraftWorkflow = (snippetId: string) => {
  return useQuery(consoleQuery.snippets.draftWorkflow.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  }))
}

export const useSnippetDraftConfig = (snippetId: string) => {
  return useQuery(consoleQuery.snippets.draftConfig.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  }))
}

export const useSnippetPublishedWorkflow = (snippetId: string) => {
  return useQuery(consoleQuery.snippets.publishedWorkflow.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  }))
}

export const useSnippetDefaultBlockConfigs = (snippetId: string) => {
  return useQuery(consoleQuery.snippets.defaultBlockConfigs.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  }))
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
