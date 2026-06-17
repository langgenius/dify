import type { AgentInlineBinding } from '../../block-selector/types'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
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

export function useAgentRosterDetail(agentId?: string) {
  return useQuery(consoleQuery.agent.byAgentId.get.queryOptions({
    input: agentId
      ? {
          params: {
            agent_id: agentId,
          },
        }
      : skipToken,
  }))
}

export function useWorkflowInlineAgentDetail(nodeId?: string, agentId?: string | null) {
  const configsMap = useHooksStore(state => state.configsMap)

  return useQuery(consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryOptions({
    input: configsMap?.flowId && configsMap.flowType === FlowType.appFlow && nodeId && agentId
      ? {
          params: {
            app_id: configsMap.flowId,
            node_id: nodeId,
          },
        }
      : skipToken,
  }))
}

export function useCreateInlineAgentBinding() {
  const { t } = useTranslation('agentV2')
  const configsMap = useHooksStore(state => state.configsMap)
  const { data: defaultModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const {
    isPending,
    mutate,
  } = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put.mutationOptions(),
  )

  const createInlineAgentBinding = useCallback((nodeId: string, options?: CreateInlineAgentBindingOptions) => {
    if (!configsMap?.flowId || configsMap.flowType !== FlowType.appFlow) {
      toast.error(t('roster.nodeSelector.createInlineFailed'))
      options?.onError?.()
      return
    }

    mutate(
      {
        params: {
          app_id: configsMap.flowId,
          node_id: nodeId,
        },
        body: {
          variant: 'workflow',
          save_strategy: 'node_job_only',
          soul_lock: {
            locked: false,
          },
          agent_soul: getDefaultAgentSoul(defaultModel),
        },
      },
      {
        onSuccess: (composerState) => {
          const binding = composerState.binding

          if (
            binding?.binding_type !== 'inline_agent'
            || !binding.agent_id
            || !binding.current_snapshot_id
          ) {
            toast.error(t('roster.nodeSelector.createInlineFailed'))
            options?.onError?.()
            return
          }

          options?.onSuccess?.({
            binding_type: 'inline_agent',
            agent_id: binding.agent_id,
            current_snapshot_id: binding.current_snapshot_id,
          })
        },
        onError: () => {
          options?.onError?.()
        },
      },
    )
  }, [configsMap?.flowId, configsMap?.flowType, defaultModel, mutate, t])

  return {
    createInlineAgentBinding,
    isCreatingInlineAgent: isPending,
  }
}
