import type { AgentInlineBinding } from '../../block-selector/types'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { toast } from '@/app/notifications'
import { useInlineAgentScope } from '@/features/agent-v2/analytics'
import { consoleQuery } from '@/service/console'
import { trackCreateApp } from '@/utils/create-app-tracking'
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
const INLINE_AGENT_CREATION_RETRY_COUNT = 5

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
  const resource = useAtomValue(editorResourceAtom)
  const refetchUntilReady = options?.pollUntilReady
    ? {
        retry: INLINE_AGENT_CREATION_RETRY_COUNT,
        refetchInterval: (query: {
          state: {
            data?: {
              agent?: unknown
            }
            status: 'error' | 'pending' | 'success'
          }
        }) =>
          query.state.status === 'error' || query.state.data?.agent
            ? false
            : INLINE_AGENT_CREATION_REFETCH_INTERVAL,
      }
    : {}

  const appComposerQuery = useQuery(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryOptions({
      input:
        resource.kind === 'app' && nodeId && agentId
          ? {
              params: {
                app_id: resource.appId,
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
          resource.kind === 'snippet' && nodeId && agentId
            ? {
                params: {
                  snippet_id: resource.snippetId,
                  node_id: nodeId,
                },
              }
            : skipToken,
        ...refetchUntilReady,
      },
    ),
  )

  return resource.kind === 'snippet' ? snippetComposerQuery : appComposerQuery
}

export function useCreateInlineAgentBinding() {
  const { t } = useTranslation(['agentV2', 'agentRoster'])
  const resource = useAtomValue(editorResourceAtom)
  const agentScope = useInlineAgentScope()
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
      if (resource.kind !== 'app' && resource.kind !== 'snippet') {
        toast.error(t(($) => $['roster.nodeSelector.createInlineFailed'], { ns: 'agentRoster' }))
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
          resource.kind === 'snippet'
            ? await mutateSnippetComposerAsync({
                params: {
                  snippet_id: resource.snippetId,
                  node_id: nodeId,
                },
                body,
              })
            : await mutateAppComposerAsync({
                params: {
                  app_id: resource.appId,
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
          toast.error(t(($) => $['roster.nodeSelector.createInlineFailed'], { ns: 'agentRoster' }))
          options?.onError?.()
          return
        }

        if (resource.kind === 'snippet') {
          queryClient.setQueryData(
            consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
              {
                input: {
                  params: {
                    snippet_id: resource.snippetId,
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
                  app_id: resource.appId,
                  node_id: nodeId,
                },
              },
            }),
            composerState,
          )
        }
        trackCreateApp({
          source: 'studio_blank',
          appMode: 'agent-v2',
          agentScope,
        })
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
      agentScope,
      resource,
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
