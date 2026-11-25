import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { SnippetWorkflowResponse } from '@dify/contracts/api/console/snippets/types.gen'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { mutationOptions, skipToken } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'

const WORKFLOW_VERSIONS_PAGE_SIZE = 10

export function appWorkflowQueryOptions(appId: string | null | undefined) {
  return consoleQuery.apps.byAppId.workflows.publish.get.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
  })
}

export function appWorkflowVersionsInfiniteQueryOptions(appId: string | null | undefined) {
  return consoleQuery.apps.byAppId.workflows.get.infiniteOptions({
    input: appId
      ? (pageParam) => ({
          params: {
            app_id: appId,
          },
          query: {
            limit: WORKFLOW_VERSIONS_PAGE_SIZE,
            page: Number(pageParam),
          },
        })
      : skipToken,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })
}

export function workflowRunHistoryQueryOptions(resource: EditorResource) {
  switch (resource.kind) {
    case 'app':
      return resource.mode === 'advanced-chat'
        ? consoleQuery.apps.byAppId.advancedChat.workflowRuns.get.queryOptions({
            input: { params: { app_id: resource.appId } },
            staleTime: 0,
          })
        : consoleQuery.apps.byAppId.workflowRuns.get.queryOptions({
            input: { params: { app_id: resource.appId } },
            staleTime: 0,
          })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflowRuns.get.queryOptions({
        input: { params: { pipeline_id: resource.pipelineId } },
        staleTime: 0,
      })
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflowRuns.get.queryOptions({
        input: { params: { snippet_id: resource.snippetId } },
        staleTime: 0,
      })
  }
}

type WorkflowVersionEnvironment = {
  id: string
  name: string
}

// One entry of a version list. The enterprise gateway adds `environments` to the app version
// list (`GET /apps/{app_id}/workflows`) so the editor can block deleting deployed versions; the
// Dify API never returns it, so it is not part of the generated contract.
export type WorkflowVersionListItem = (WorkflowResponse | SnippetWorkflowResponse) & {
  environments?: WorkflowVersionEnvironment[]
}

type WorkflowVersionHistoryFilters = {
  limit: number
  userId?: string
  namedOnly?: boolean
}

export function workflowVersionHistoryInfiniteOptions(
  resource: EditorResource,
  { limit, userId, namedOnly }: WorkflowVersionHistoryFilters,
) {
  const getNextPageParam = (lastPage: { has_more: boolean; page: number }) =>
    lastPage.has_more ? lastPage.page + 1 : undefined
  const filters = { limit, user_id: userId || undefined, named_only: !!namedOnly }
  switch (resource.kind) {
    case 'app':
      return consoleQuery.apps.byAppId.workflows.get.infiniteOptions({
        input: (page: number) => ({
          params: { app_id: resource.appId },
          query: { ...filters, page },
        }),
        getNextPageParam,
        initialPageParam: 1,
      })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflows.get.infiniteOptions({
        input: (page: number) => ({
          params: { pipeline_id: resource.pipelineId },
          query: { ...filters, page },
        }),
        getNextPageParam,
        initialPageParam: 1,
      })
    case 'snippet':
      // The snippet version list has no user or named-version filters.
      return consoleQuery.snippets.bySnippetId.workflows.get.infiniteOptions({
        input: (page: number) => ({
          params: { snippet_id: resource.snippetId },
          query: { limit, page },
        }),
        getNextPageParam,
        initialPageParam: 1,
      })
  }
}

// Prefix of every version list page set for the resource, regardless of filters.
export function workflowVersionHistoryKey(
  resource: EditorResource | { kind: 'app'; appId: string },
) {
  switch (resource.kind) {
    case 'app':
      return consoleQuery.apps.byAppId.workflows.get.key({
        type: 'infinite',
        input: { params: { app_id: resource.appId } },
      })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
        type: 'infinite',
        input: { params: { pipeline_id: resource.pipelineId } },
      })
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflows.get.key({
        type: 'infinite',
        input: { params: { snippet_id: resource.snippetId } },
      })
  }
}

export function lastRunQueryOptions(resource: EditorResource, nodeId: string) {
  switch (resource.kind) {
    case 'app':
      return consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions({
        input: { params: { app_id: resource.appId, node_id: nodeId } },
        retry: 0,
        context: { silent: true },
      })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions(
        {
          input: { params: { pipeline_id: resource.pipelineId, node_id: nodeId } },
          retry: 0,
          context: { silent: true },
        },
      )
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions(
        {
          input: { params: { snippet_id: resource.snippetId, node_id: nodeId } },
          retry: 0,
          context: { silent: true },
        },
      )
  }
}

export function lastRunQueryKey(resource: EditorResource, nodeId?: string) {
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
export function conversationVarValuesQueryOptions(resource: EditorResource | undefined) {
  return consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryOptions({
    input: resource?.kind === 'app' ? { params: { app_id: resource.appId } } : skipToken,
    select: (response) => response.items,
  })
}

export function sysVarValuesQueryOptions(resource: EditorResource | undefined) {
  return consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryOptions({
    input: resource?.kind === 'app' ? { params: { app_id: resource.appId } } : skipToken,
    select: (response) => response.items,
  })
}

export function restoreWorkflowMutationOptions(resource: EditorResource) {
  return mutationOptions({
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

export function resetInspectorVarMutationOptions(resource: EditorResource) {
  return mutationOptions({
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

export function deleteAllInspectorVarsMutationOptions(resource: EditorResource) {
  return mutationOptions({
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

export function deleteNodeInspectorVarsMutationOptions(resource: EditorResource) {
  return mutationOptions({
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

export function deleteInspectVarMutationOptions(resource: EditorResource) {
  return mutationOptions({
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

export function editInspectorVarMutationOptions(resource: EditorResource) {
  return mutationOptions({
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
