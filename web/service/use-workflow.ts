import type { UseQueryOptions } from '@tanstack/react-query'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type {
  FetchWorkflowDraftPageParams,
  FetchWorkflowDraftPageResponse,
  WorkflowRunHistoryResponse,
} from '@/types/workflow'
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleClient, consoleQuery } from '@/service/console'
// oxlint-disable-next-line no-restricted-imports -- run and version history hooks take prebuilt flow URLs
import { get } from './base'
import { legacyWorkflowVersionHistoryKey } from './console/workflow-version-cache'
import { appWorkflowQueryOptions, appWorkflowVersionsInfiniteQueryKey } from './workflow-queries'

const NAME_SPACE = 'workflow'

type UseAppWorkflowOptions = Pick<UseQueryOptions, 'retry'>

export const useAppWorkflow = (appID: string, options?: UseAppWorkflowOptions) => {
  return useQuery({
    ...appWorkflowQueryOptions(appID),
    ...options,
  })
}

const WorkflowRunHistoryKey = [NAME_SPACE, 'runHistory']

export const useWorkflowRunHistory = (url?: string, enabled = true) => {
  return useQuery<WorkflowRunHistoryResponse>({
    queryKey: [...WorkflowRunHistoryKey, url],
    queryFn: () => get<WorkflowRunHistoryResponse>(url as string),
    enabled: !!url && enabled,
    staleTime: 0,
  })
}

export const useInvalidateWorkflowRunHistory = () => {
  const queryClient = useQueryClient()
  return (url: string) => {
    queryClient.invalidateQueries({
      queryKey: [...WorkflowRunHistoryKey, url],
    })
  }
}

export const useInvalidateAppWorkflow = () => {
  const queryClient = useQueryClient()
  return (appID: string) => {
    return queryClient.invalidateQueries({
      queryKey: appWorkflowQueryOptions(appID).queryKey,
    })
  }
}

const WorkflowVersionHistoryKey = legacyWorkflowVersionHistoryKey

export const useWorkflowVersionHistory = (params: FetchWorkflowDraftPageParams) => {
  const { url, initialPage, limit, userId, namedOnly } = params
  return useInfiniteQuery({
    enabled: !!url,
    queryKey: [...WorkflowVersionHistoryKey, url, initialPage, limit, userId, namedOnly],
    queryFn: ({ pageParam = 1 }) =>
      get<FetchWorkflowDraftPageResponse>(url, {
        params: {
          page: pageParam,
          limit,
          user_id: userId || '',
          named_only: !!namedOnly,
        },
      }),
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : null),
    initialPageParam: initialPage,
  })
}

export const useResetWorkflowVersionHistory = () => {
  const queryClient = useQueryClient()

  return () =>
    Promise.all([
      queryClient.resetQueries({ queryKey: [...WorkflowVersionHistoryKey] }),
      queryClient.resetQueries({ queryKey: appWorkflowVersionsInfiniteQueryKey() }),
    ])
}

type UpdateVersionParams = {
  resource:
    | Omit<Extract<EditorResource, { kind: 'app' }>, 'mode'>
    | Exclude<EditorResource, { kind: 'app' }>
  versionId: string
  title: string
  releaseNotes: string
}

export const useUpdateWorkflow = () => {
  const { mutateAsync: updateAppVersion } = useMutation(
    consoleQuery.apps.byAppId.workflows.byWorkflowId.patch.mutationOptions(),
  )
  const { mutateAsync: updatePipelineVersion } = useMutation(
    consoleQuery.rag.pipelines.byPipelineId.workflows.byWorkflowId.patch.mutationOptions(),
  )
  const { mutateAsync: updateSnippetVersion } = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.byWorkflowId.patch.mutationOptions(),
  )
  const mutateAsync = useCallback(
    ({ resource, versionId, title, releaseNotes }: UpdateVersionParams) => {
      const body = { marked_name: title, marked_comment: releaseNotes }
      switch (resource.kind) {
        case 'app':
          return updateAppVersion({
            params: { app_id: resource.appId, workflow_id: versionId },
            body,
          })
        case 'knowledge-pipeline':
          return updatePipelineVersion({
            params: { pipeline_id: resource.pipelineId, workflow_id: versionId },
            body,
          })
        case 'snippet':
          return updateSnippetVersion({
            params: { snippet_id: resource.snippetId, workflow_id: versionId },
            body,
          })
      }
    },
    [updateAppVersion, updatePipelineVersion, updateSnippetVersion],
  )
  return { mutateAsync }
}

export const useDeleteWorkflow = (resource: EditorResource) => {
  const { mutateAsync: deleteAppVersion } = useMutation(
    consoleQuery.apps.byAppId.workflows.byWorkflowId.delete.mutationOptions(),
  )
  const { mutateAsync: deletePipelineVersion } = useMutation(
    consoleQuery.rag.pipelines.byPipelineId.workflows.byWorkflowId.delete.mutationOptions(),
  )
  const { mutateAsync: deleteSnippetVersion } = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.byWorkflowId.delete.mutationOptions(),
  )

  return useCallback(
    (versionId: string) => {
      switch (resource.kind) {
        case 'app':
          return deleteAppVersion({ params: { app_id: resource.appId, workflow_id: versionId } })
        case 'knowledge-pipeline':
          return deletePipelineVersion({
            params: { pipeline_id: resource.pipelineId, workflow_id: versionId },
          })
        case 'snippet':
          return deleteSnippetVersion({
            params: { snippet_id: resource.snippetId, workflow_id: versionId },
          })
      }
    },
    [resource, deleteAppVersion, deletePipelineVersion, deleteSnippetVersion],
  )
}

export const useRestoreWorkflow = (resource: EditorResource) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'restore'],
    mutationFn: (versionId: string) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.byWorkflowId.restore.post(
            { params: { app_id: resource.appId, workflow_id: versionId } },
            { context: { silent: true } },
          )
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.byWorkflowId.restore.post(
            { params: { pipeline_id: resource.pipelineId, workflow_id: versionId } },
            { context: { silent: true } },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.byWorkflowId.restore.post(
            { params: { snippet_id: resource.snippetId, workflow_id: versionId } },
            { context: { silent: true } },
          )
      }
    },
  })
}

function lastRunQueryOptions(resource: EditorResource, nodeId: string, enabled: boolean) {
  switch (resource.kind) {
    case 'app':
      return consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions({
        input: { params: { app_id: resource.appId, node_id: nodeId } },
        enabled,
        retry: 0,
        context: { silent: true },
      })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions(
        {
          input: { params: { pipeline_id: resource.pipelineId, node_id: nodeId } },
          enabled,
          retry: 0,
          context: { silent: true },
        },
      )
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions(
        {
          input: { params: { snippet_id: resource.snippetId, node_id: nodeId } },
          enabled,
          retry: 0,
          context: { silent: true },
        },
      )
  }
}
function lastRunQueryKey(resource: EditorResource, nodeId?: string) {
  switch (resource.kind) {
    case 'app':
      return consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.key({
        type: 'query',
        input: { params: { app_id: resource.appId, ...(nodeId ? { node_id: nodeId } : {}) } },
      })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.lastRun.get.key(
        {
          type: 'query',
          input: {
            params: { pipeline_id: resource.pipelineId, ...(nodeId ? { node_id: nodeId } : {}) },
          },
        },
      )
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.key({
        type: 'query',
        input: {
          params: { snippet_id: resource.snippetId, ...(nodeId ? { node_id: nodeId } : {}) },
        },
      })
  }
}
export const useLastRun = (resource: EditorResource, nodeId: string, enabled: boolean) =>
  useQuery(lastRunQueryOptions(resource, nodeId, enabled))

export const useInvalidateLastRun = (resource: EditorResource, nodeId: string) => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: lastRunQueryKey(resource, nodeId) })
}

export const useInvalidateAllLastRun = (resource: EditorResource) => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: lastRunQueryKey(resource) })
}

export const useConversationVarValues = (resource: EditorResource | undefined) => {
  return useQuery(
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryOptions({
      input: resource?.kind === 'app' ? { params: { app_id: resource.appId } } : skipToken,
      select: (response) => response.items,
    }),
  )
}

export const useInvalidateConversationVarValues = (resource: EditorResource) => {
  const queryClient = useQueryClient()
  return () =>
    resource.kind === 'app'
      ? queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryKey({
            input: { params: { app_id: resource.appId } },
          }),
        })
      : Promise.resolve()
}

export const useResetInspectorVar = (resource: EditorResource) => {
  return useMutation({
    mutationFn: (varId: string) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.variables.byVariableId.reset.put({
            params: { app_id: resource.appId, variable_id: varId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.byVariableId.reset.put(
            { params: { pipeline_id: resource.pipelineId, variable_id: varId } },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.variables.byVariableId.reset.put(
            { params: { snippet_id: resource.snippetId, variable_id: varId } },
          )
      }
    },
  })
}

export const useSysVarValues = (resource: EditorResource | undefined) => {
  return useQuery(
    consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryOptions({
      input: resource?.kind === 'app' ? { params: { app_id: resource.appId } } : skipToken,
      select: (response) => response.items,
    }),
  )
}

export const useInvalidateSysVarValues = (resource: EditorResource) => {
  const queryClient = useQueryClient()
  return () =>
    resource.kind === 'app'
      ? queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryKey({
            input: { params: { app_id: resource.appId } },
          }),
        })
      : Promise.resolve()
}

export const useDeleteAllInspectorVars = (resource: EditorResource) => {
  return useMutation({
    mutationFn: () => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.variables.delete({
            params: { app_id: resource.appId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.delete({
            params: { pipeline_id: resource.pipelineId },
          })
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.variables.delete({
            params: { snippet_id: resource.snippetId },
          })
      }
    },
  })
}

export const useDeleteNodeInspectorVars = (resource: EditorResource) => {
  return useMutation({
    mutationFn: (nodeId: string) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.variables.delete({
            params: { app_id: resource.appId, node_id: nodeId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.variables.delete(
            { params: { pipeline_id: resource.pipelineId, node_id: nodeId } },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.nodes.byNodeId.variables.delete(
            { params: { snippet_id: resource.snippetId, node_id: nodeId } },
          )
      }
    },
  })
}

export const useDeleteInspectVar = (resource: EditorResource) => {
  return useMutation({
    mutationFn: (varId: string) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.variables.byVariableId.delete({
            params: { app_id: resource.appId, variable_id: varId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.byVariableId.delete(
            { params: { pipeline_id: resource.pipelineId, variable_id: varId } },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.variables.byVariableId.delete({
            params: { snippet_id: resource.snippetId, variable_id: varId },
          })
      }
    },
  })
}

// edit the name or value of the inspector var
export const useEditInspectorVar = (resource: EditorResource) => {
  return useMutation({
    mutationFn: ({ varId, ...body }: { varId: string; name?: string; value?: unknown }) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.variables.byVariableId.patch({
            params: { app_id: resource.appId, variable_id: varId },
            body,
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.byVariableId.patch(
            { params: { pipeline_id: resource.pipelineId, variable_id: varId }, body },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.variables.byVariableId.patch({
            params: { snippet_id: resource.snippetId, variable_id: varId },
            body,
          })
      }
    },
  })
}

export const useTestEmailSender = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'test email sender'],
    mutationFn: async (data: {
      appID: string
      nodeID: string
      deliveryID: string
      inputs: Record<string, unknown>
    }) => {
      const { appID, nodeID, deliveryID, inputs } = data
      return consoleClient.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.deliveryTest.post(
        {
          params: { app_id: appID, node_id: nodeID },
          body: { delivery_method_id: deliveryID, inputs },
        },
      )
    },
  })
}
