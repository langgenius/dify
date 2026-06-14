'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import type { ComposerSaveStrategy } from '@dify/contracts/api/console/apps/types.gen'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { debounce } from 'es-toolkit/compat'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'

const DRAFT_AUTOSAVE_WAIT = 5000

type AgentConfigurePublishPayload = {
  agent_id: string
  config_snapshot: AgentSoulConfig
}

export function useAgentConfigureSync({
  agentId,
  appId,
  baseConfig,
  currentModel,
  enabled,
}: {
  agentId: string
  appId?: string | null
  baseConfig?: AgentSoulConfig
  currentModel?: DefaultModel
  enabled: boolean
}) {
  const queryClient = useQueryClient()
  const draft = useAtomValue(agentComposerDraftAtom)
  const isDirty = useAtomValue(isAgentComposerDirtyAtom)
  const setOriginalConfig = useSetAtom(agentComposerOriginalConfigAtom)
  const setOriginalDraft = useSetAtom(agentComposerOriginalDraftAtom)
  const [isPublishing, setIsPublishing] = useState(false)
  const agentSoulDraft = useMemo(() => formStateToAgentSoulConfig({
    baseConfig,
    formState: draft,
    currentModel,
  }), [baseConfig, currentModel, draft])
  const agentSoulDraftKey = useMemo(() => JSON.stringify(agentSoulDraft), [agentSoulDraft])
  const lastAutosavedDraftKeyRef = useRef<string | undefined>(undefined)
  const saveComposerMutation = useMutation(
    consoleQuery.apps.byAppId.agentComposer.put.mutationOptions({
      onSuccess: (composerState, variables) => {
        queryClient.setQueryData(
          consoleQuery.apps.byAppId.agentComposer.get.queryKey({ input: { params: variables.params } }),
          composerState,
        )
        queryClient.setQueryData(
          consoleQuery.agents.byAgentId.get.queryKey({
            input: {
              params: {
                agent_id: agentId,
              },
            },
          }),
          agent => agent
            ? {
                ...agent,
                active_config_snapshot: composerState.active_config_snapshot,
                active_config_snapshot_id: composerState.active_config_snapshot.id,
              }
            : agent,
        )
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.agents.byAgentId.versions.get.key(),
        })
      },
    }),
  )

  const saveComposer = useSerialAsyncCallback(async (
    saveStrategy: ComposerSaveStrategy,
    configSnapshot = agentSoulDraft,
  ) => {
    if (!appId)
      return

    const savedDraftKey = JSON.stringify(configSnapshot)
    const composerState = await saveComposerMutation.mutateAsync({
      params: {
        app_id: appId,
      },
      body: {
        variant: 'agent_app',
        save_strategy: saveStrategy,
        agent_soul: configSnapshot,
      },
    })

    if (saveStrategy === 'save_to_current_version') {
      lastAutosavedDraftKeyRef.current = savedDraftKey
      return
    }

    setOriginalConfig(composerState.agent_soul)
    setOriginalDraft(agentSoulConfigToFormState(composerState.agent_soul))
    lastAutosavedDraftKeyRef.current = savedDraftKey
  })

  const latestDraftSaveRef = useRef<() => void>(() => undefined)
  latestDraftSaveRef.current = () => {
    void saveComposer('save_to_current_version')
  }

  const debouncedSaveDraft = useMemo(() => debounce(() => {
    latestDraftSaveRef.current()
  }, DRAFT_AUTOSAVE_WAIT), [])

  useEffect(() => {
    if (!enabled || !appId || !isDirty || lastAutosavedDraftKeyRef.current === agentSoulDraftKey)
      return

    debouncedSaveDraft()
  }, [agentSoulDraftKey, appId, debouncedSaveDraft, enabled, isDirty])

  useEffect(() => {
    return () => {
      debouncedSaveDraft.flush?.()
    }
  }, [debouncedSaveDraft])

  const publishDraft = useCallback(async (payload: AgentConfigurePublishPayload) => {
    debouncedSaveDraft.cancel?.()
    setIsPublishing(true)
    try {
      await saveComposer('save_as_new_version', payload.config_snapshot)
    }
    catch {
      // Draft sync follows workflow autosave behavior: save failures are silent and keep the local draft intact.
    }
    finally {
      setIsPublishing(false)
    }
  }, [debouncedSaveDraft, saveComposer])

  return {
    isPublishing,
    publishDraft,
  }
}
