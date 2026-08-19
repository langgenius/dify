import type { FetchWorkflowDraftResponse, VarInInspect } from '@/types/workflow'
import { queryOptions, skipToken } from '@tanstack/react-query'
import { FlowType } from '@/types/common'
import { consoleQuery } from './client'
import { fetchAllInspectVars } from './workflow'

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

export function appWorkflowDefaultBlockConfigsQueryOptions(appId: string) {
  return consoleQuery.apps.byAppId.workflows.defaultWorkflowBlockConfigs.get.queryOptions({
    input: {
      params: {
        app_id: appId,
      },
    },
  })
}

export function appWorkflowDraftQueryOptions(appId: string) {
  const input = {
    params: {
      app_id: appId,
    },
  }

  return queryOptions({
    queryKey: consoleQuery.apps.byAppId.workflows.draft.get.key({ input }),
    queryFn: ({ signal }) =>
      consoleQuery.apps.byAppId.workflows.draft.get.call(input, {
        signal,
        context: { silent: true },
      }) as Promise<FetchWorkflowDraftResponse>,
    retry: false,
    staleTime: 0,
  })
}

export function appWorkflowInspectVariablesQueryKey(appId: string) {
  return consoleQuery.apps.byAppId.workflows.draft.variables.get.key({
    input: {
      params: {
        app_id: appId,
      },
    },
  })
}

export function appWorkflowConversationVariableValuesQueryOptions(appId?: string) {
  return consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
    select: (data) => (data.items ?? []) as VarInInspect[],
  })
}

export function appWorkflowSystemVariableValuesQueryOptions(appId?: string) {
  return consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
    select: (data) => (data.items ?? []) as VarInInspect[],
  })
}

const workflowInspectVariablesQueryKey = (flowType: FlowType, flowId: string) => {
  if (flowType === FlowType.ragPipeline) {
    return consoleQuery.rag.pipelines.byPipelineId.workflows.draft.variables.get.key({
      input: {
        params: {
          pipeline_id: flowId,
        },
      },
    })
  }

  if (flowType === FlowType.snippet) {
    return consoleQuery.snippets.bySnippetId.workflows.draft.variables.get.key({
      input: {
        params: {
          snippet_id: flowId,
        },
      },
    })
  }

  return appWorkflowInspectVariablesQueryKey(flowId)
}

export function workflowInspectVariablesQueryOptions(flowType?: FlowType, flowId?: string) {
  return queryOptions({
    queryKey:
      flowType && flowId
        ? workflowInspectVariablesQueryKey(flowType, flowId)
        : consoleQuery.apps.byAppId.workflows.draft.variables.get.key(),
    queryFn: ({ signal }) => {
      if (!flowType || !flowId) return Promise.resolve([])
      return fetchAllInspectVars(flowType, flowId, signal)
    },
    enabled: Boolean(flowType && flowId),
    retry: false,
    staleTime: 0,
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

export function appWorkflowVersionsInfiniteQueryKey() {
  return consoleQuery.apps.byAppId.workflows.get.key({ type: 'infinite' })
}
