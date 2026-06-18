'use client'

import type { AgentSoulConfig, ComposerSaveStrategy } from '@dify/contracts/api/console/agent/types.gen'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { debounce } from 'es-toolkit/compat'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  agentComposerPublishedDraftAtom,
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
  baseConfig,
  currentModel,
  enabled,
}: {
  agentId: string
  baseConfig?: AgentSoulConfig
  currentModel?: DefaultModel
  enabled: boolean
}) {
  const queryClient = useQueryClient()
  const store = useStore()
  const setOriginalConfig = useSetAtom(agentComposerOriginalConfigAtom)
  const setOriginalDraft = useSetAtom(agentComposerOriginalDraftAtom)
  const setPublishedDraft = useSetAtom(agentComposerPublishedDraftAtom)
  const [isPublishing, setIsPublishing] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<number | undefined>(undefined)
  const baseConfigRef = useRef(baseConfig)
  const currentModelRef = useRef(currentModel)
  const enabledRef = useRef(enabled)
  const lastAutosavedDraftKeyRef = useRef<string | undefined>(undefined)

  baseConfigRef.current = baseConfig
  currentModelRef.current = currentModel
  enabledRef.current = enabled

  const getAgentSoulDraft = useCallback(() => formStateToAgentSoulConfig({
    baseConfig: baseConfigRef.current,
    formState: store.get(agentComposerDraftAtom),
    currentModel: currentModelRef.current,
  }), [store])

  const saveComposerMutation = useMutation(
    consoleQuery.agent.byAgentId.composer.put.mutationOptions(),
  )

  const saveComposer = useSerialAsyncCallback(async (
    saveStrategy: ComposerSaveStrategy,
    configSnapshot: AgentSoulConfig,
  ) => {
    const savedDraftKey = JSON.stringify(configSnapshot)
    const composerState = await saveComposerMutation.mutateAsync({
      params: {
        agent_id: agentId,
      },
      body: {
        variant: 'agent_app',
        save_strategy: saveStrategy,
        agent_soul: configSnapshot,
      },
    })

    if (saveStrategy === 'save_to_current_version') {
      setOriginalDraft(agentSoulConfigToFormState(configSnapshot))
      setDraftSavedAt(Date.now())
      lastAutosavedDraftKeyRef.current = savedDraftKey
      return
    }

    queryClient.setQueryData(
      consoleQuery.agent.byAgentId.composer.get.queryKey({ input: { params: { agent_id: agentId } } }),
      composerState,
    )
    queryClient.setQueryData(
      consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
      (agentDetail) => {
        if (!agentDetail)
          return agentDetail

        return {
          ...agentDetail,
          active_config_is_published: true,
        }
      },
    )
    void queryClient.invalidateQueries({
      queryKey: consoleQuery.agent.byAgentId.versions.get.key(),
    })
    setOriginalConfig(composerState.agent_soul)
    const publishedDraft = agentSoulConfigToFormState(composerState.agent_soul)
    setOriginalDraft(publishedDraft)
    setPublishedDraft(publishedDraft)
    lastAutosavedDraftKeyRef.current = savedDraftKey
  })

  const latestDraftSaveRef = useRef<() => void>(() => undefined)
  latestDraftSaveRef.current = () => {
    void saveComposer('save_to_current_version', getAgentSoulDraft())
  }

  const debouncedSaveDraft = useMemo(() => debounce(() => {
    latestDraftSaveRef.current()
  }, DRAFT_AUTOSAVE_WAIT), [])

  const saveDraft = useCallback(async () => {
    if (!enabledRef.current)
      return

    debouncedSaveDraft.cancel?.()
    await saveComposer('save_to_current_version', getAgentSoulDraft())
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
    draftSavedAt,
    isPublishing,
    publishDraft,
    saveDraft,
  }
}
