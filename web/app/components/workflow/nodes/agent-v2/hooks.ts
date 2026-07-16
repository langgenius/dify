import type { AgentInlineBinding } from '../../block-selector/types'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { consoleQuery } from '@/service/client'
import { FlowType } from '@/types/common'
import { getDefaultAgentSoul } from './agent-soul-config'

type CreatedInlineAgentBinding = AgentInlineBinding & {
  agent_id: string
  current_snapshot_id: string
}

type CreateInlineAgentBindingOptions = {
  onError?: () => void
  onSuccess?: (binding: CreatedInlineAgentBinding) => void
}

const INLINE_AGENT_CREATION_REFETCH_INTERVAL = 1000

export function useAgentRosterDetail(agentId?: string) {
  return useQuery(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: agentId
        ? {
            params: {
              agent_id: agentId,
            },
          }
        : skipToken,
    }),
  )
}

export function useWorkflowInlineAgentDetail(
  nodeId?: string,
  agentId?: string | null,
  options?: {
    pollUntilReady?: boolean
  },
) {
  const configsMap = useHooksStore((state) => state.configsMap)
  const refetchUntilReady = options?.pollUntilReady
    ? {
        refetchInterval: (query: {
          state: {
            data?: {
              agent?: unknown
            }
          }
        }) => (query.state.data?.agent ? false : INLINE_AGENT_CREATION_REFETCH_INTERVAL),
      }
    : {}

  const appComposerQuery = useQuery(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryOptions({
      input:
        configsMap?.flowId && configsMap.flowType === FlowType.appFlow && nodeId && agentId
          ? {
              params: {
                app_id: configsMap.flowId,
                node_id: nodeId,
              },
            }
          : skipToken,
      ...refetchUntilReady,
    }),
  )
  const snippetComposerQuery = useQuery(
    consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryOptions(
      {
        input:
          configsMap?.flowId && configsMap.flowType === FlowType.snippet && nodeId && agentId
            ? {
                params: {
                  snippet_id: configsMap.flowId,
                  node_id: nodeId,
                },
              }
            : skipToken,
        ...refetchUntilReady,
      },
    ),
  )

  return configsMap?.flowType === FlowType.snippet ? snippetComposerQuery : appComposerQuery
}

export function useCreateInlineAgentBinding() {
  const { t } = useTranslation('agentV2')
  const configsMap = useHooksStore((state) => state.configsMap)
  const { data: defaultModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const queryClient = useQueryClient()
  const { isPending: isAppComposerPending, mutateAsync: mutateAppComposerAsync } = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put.mutationOptions(),
  )
  const { isPending: isSnippetComposerPending, mutateAsync: mutateSnippetComposerAsync } =
    useMutation(
      consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.put.mutationOptions(),
    )

  const createInlineAgentBinding = useCallback(
    async (nodeId: string, options?: CreateInlineAgentBindingOptions) => {
      if (
        !configsMap?.flowId ||
        (configsMap.flowType !== FlowType.appFlow && configsMap.flowType !== FlowType.snippet)
      ) {
        toast.error(t(($) => $['roster.nodeSelector.createInlineFailed']))
        options?.onError?.()
        return
      }

      try {
        const body = {
          variant: 'workflow' as const,
          save_strategy: 'node_job_only' as const,
          binding: {
            binding_type: 'inline_agent' as const,
          },
          soul_lock: {
            locked: false,
          },
          agent_soul: getDefaultAgentSoul(defaultModel),
        }
        const composerState =
          configsMap.flowType === FlowType.snippet
            ? await mutateSnippetComposerAsync({
                params: {
                  snippet_id: configsMap.flowId,
                  node_id: nodeId,
                },
                body,
              })
            : await mutateAppComposerAsync({
                params: {
                  app_id: configsMap.flowId,
                  node_id: nodeId,
                },
                body,
              })
        const binding = composerState.binding

        if (
          binding?.binding_type !== 'inline_agent' ||
          !binding.agent_id ||
          !binding.current_snapshot_id
        ) {
          toast.error(t(($) => $['roster.nodeSelector.createInlineFailed']))
          options?.onError?.()
          return
        }

        if (configsMap.flowType === FlowType.snippet) {
          queryClient.setQueryData(
            consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
              {
                input: {
                  params: {
                    snippet_id: configsMap.flowId,
                    node_id: nodeId,
                  },
                },
              },
            ),
            composerState,
          )
        } else {
          queryClient.setQueryData(
            consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
              input: {
                params: {
                  app_id: configsMap.flowId,
                  node_id: nodeId,
                },
              },
            }),
            composerState,
          )
        }
        options?.onSuccess?.({
          binding_type: 'inline_agent',
          agent_id: binding.agent_id,
          current_snapshot_id: binding.current_snapshot_id,
        })
      } catch {
        options?.onError?.()
      }
    },
    [
      configsMap?.flowId,
      configsMap?.flowType,
      defaultModel,
      mutateAppComposerAsync,
      mutateSnippetComposerAsync,
      queryClient,
      t,
    ],
  )

  return {
    createInlineAgentBinding,
    isCreatingInlineAgent: isAppComposerPending || isSnippetComposerPending,
  }
}
