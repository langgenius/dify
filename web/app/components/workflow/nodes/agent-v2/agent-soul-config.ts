import type { AgentSoulConfig, WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { DefaultModelResponse } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { debounce } from 'es-toolkit/compat'
import { useStore as useJotaiStore, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function getModelProviderPluginId(provider: string) {
  const [organization, pluginName] = provider.split('/').filter(Boolean)

  if (organization && pluginName)
    return `${organization}/${pluginName}`

  return provider ? `langgenius/${provider}` : ''
}

export function getDefaultAgentSoul(defaultModel?: DefaultModelResponse): AgentSoulConfig {
  const baseConfig: AgentSoulConfig = {
    schema_version: 1,
    prompt: {
      system_prompt: '',
    },
  }

  if (!defaultModel)
    return baseConfig

  const modelProvider = defaultModel.provider.provider

  return {
    ...baseConfig,
    model: {
      model_provider: modelProvider,
      model: defaultModel.model,
      plugin_id: getModelProviderPluginId(modelProvider),
    },
  }
}

export function useWorkflowInlineAgentConfigureSync({
  nodeId,
  baseConfig,
  currentModel,
  autoSaveEnabled = true,
  enabled,
}: {
  nodeId: string
  baseConfig?: AgentSoulConfig
  currentModel?: {
    provider: string
    model: string
    plugin_id?: string
  }
  autoSaveEnabled?: boolean
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

  const saveComposer = useSerialAsyncCallback(async (configSnapshot: AgentSoulConfig): Promise<WorkflowAgentComposerResponse | undefined> => {
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
    return composerState
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
    return saveComposer(getAgentSoulDraft())
  }, [debouncedSaveDraft, getAgentSoulDraft, saveComposer])

  useEffect(() => {
    return store.sub(agentComposerDraftAtom, () => {
      const agentSoulDraft = getAgentSoulDraft()
      const agentSoulDraftKey = JSON.stringify(agentSoulDraft)

      if (
        !enabledRef.current
        || !autoSaveEnabled
        || !store.get(isAgentComposerDirtyAtom)
        || lastAutosavedDraftKeyRef.current === agentSoulDraftKey
      ) {
        return
      }

      debouncedSaveDraft()
    })
  }, [autoSaveEnabled, debouncedSaveDraft, getAgentSoulDraft, store])

  useEffect(() => {
    return () => {
      if (autoSaveEnabled)
        debouncedSaveDraft.flush?.()
    }
  }, [autoSaveEnabled, debouncedSaveDraft])

  return {
    draftSavedAt,
    saveDraft,
  }
}
