import type { AgentSoulConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentInlineBinding } from '../../block-selector/types'
import type { DefaultModelResponse } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { debounce } from 'es-toolkit/compat'
import { useStore as useJotaiStore, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'
import { FlowType } from '@/types/common'

const DRAFT_AUTOSAVE_WAIT = 5000

type CreatedInlineAgentBinding = AgentInlineBinding & {
  agent_id: string
  current_snapshot_id: string
}

type CreateInlineAgentBindingOptions = {
  onError?: () => void
  onSuccess?: (binding: CreatedInlineAgentBinding) => void
}

function getModelProviderPluginId(provider: string) {
  const [organization, pluginName] = provider.split('/').filter(Boolean)

  if (organization && pluginName)
    return `${organization}/${pluginName}`

  return provider ? `langgenius/${provider}` : ''
}

function getDefaultAgentSoul(defaultModel?: DefaultModelResponse): AgentSoulConfig | undefined {
  if (!defaultModel)
    return undefined

  const modelProvider = defaultModel.provider.provider

  return {
    schema_version: 1,
    prompt: {
      system_prompt: '',
    },
    model: {
      model_provider: modelProvider,
      model: defaultModel.model,
      plugin_id: getModelProviderPluginId(modelProvider),
    },
  }
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

    const agentSoul = getDefaultAgentSoul(defaultModel)
    if (!agentSoul) {
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
          agent_soul: agentSoul,
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

export function useWorkflowInlineAgentConfigureSync({
  nodeId,
  baseConfig,
  currentModel,
  enabled,
}: {
  nodeId: string
  baseConfig?: AgentSoulConfig
  currentModel?: {
    provider: string
    model: string
    plugin_id?: string
  }
  enabled: boolean
}) {
  const queryClient = useQueryClient()
  const configsMap = useHooksStore(state => state.configsMap)
  const store = useJotaiStore()
  const setOriginalConfig = useSetAtom(agentComposerOriginalConfigAtom)
  const setOriginalDraft = useSetAtom(agentComposerOriginalDraftAtom)
  const [draftSavedAt, setDraftSavedAt] = useState<number | undefined>(undefined)
  const baseConfigRef = useRef(baseConfig)
  const currentModelRef = useRef(currentModel)
  const enabledRef = useRef(enabled)
  const lastAutosavedDraftKeyRef = useRef<string | undefined>(undefined)
  const saveComposerMutation = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put.mutationOptions(),
  )

  baseConfigRef.current = baseConfig
  currentModelRef.current = currentModel
  enabledRef.current = enabled

  const getAgentSoulDraft = useCallback(() => formStateToAgentSoulConfig({
    baseConfig: baseConfigRef.current,
    formState: store.get(agentComposerDraftAtom),
    currentModel: currentModelRef.current,
  }), [store])

  const saveComposer = useSerialAsyncCallback(async (configSnapshot: AgentSoulConfig) => {
    if (!configsMap?.flowId || configsMap.flowType !== FlowType.appFlow)
      return

    const savedDraftKey = JSON.stringify(configSnapshot)
    const composerState = await saveComposerMutation.mutateAsync({
      params: {
        app_id: configsMap.flowId,
        node_id: nodeId,
      },
      body: {
        variant: 'workflow',
        save_strategy: 'node_job_only',
        agent_soul: configSnapshot,
      },
    })

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
    setOriginalConfig(composerState.agent_soul)
    setOriginalDraft(agentSoulConfigToFormState(composerState.agent_soul))
    setDraftSavedAt(Date.now())
    lastAutosavedDraftKeyRef.current = savedDraftKey
  })

  const latestDraftSaveRef = useRef<() => void>(() => undefined)
  latestDraftSaveRef.current = () => {
    void saveComposer(getAgentSoulDraft())
  }

  const debouncedSaveDraft = useMemo(() => debounce(() => {
    latestDraftSaveRef.current()
  }, DRAFT_AUTOSAVE_WAIT), [])

  const saveDraft = useCallback(async () => {
    if (!enabledRef.current)
      return

    debouncedSaveDraft.cancel?.()
    await saveComposer(getAgentSoulDraft())
  }, [debouncedSaveDraft, getAgentSoulDraft, saveComposer])

  useEffect(() => {
    return store.sub(agentComposerDraftAtom, () => {
      const agentSoulDraft = getAgentSoulDraft()
      const agentSoulDraftKey = JSON.stringify(agentSoulDraft)

      if (
        !enabledRef.current
        || !store.get(isAgentComposerDirtyAtom)
        || lastAutosavedDraftKeyRef.current === agentSoulDraftKey
      ) {
        return
      }

      debouncedSaveDraft()
    })
  }, [debouncedSaveDraft, getAgentSoulDraft, store])

  useEffect(() => {
    return () => {
      debouncedSaveDraft.flush?.()
    }
  }, [debouncedSaveDraft])

  return {
    draftSavedAt,
    saveDraft,
  }
}
