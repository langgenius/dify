'use client'

import type { AgentSoulConfig, ComposerSaveStrategy } from '@dify/contracts/api/console/agent/types.gen'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { debounce } from 'es-toolkit/compat'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { validateKnowledgeRetrievals } from '@/features/agent-v2/agent-composer/knowledge-validation'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  agentComposerPublishedDraftAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'

const DRAFT_AUTOSAVE_WAIT = 5000

class InvalidKnowledgeConfigurationError extends Error {
  constructor() {
    super('Agent knowledge retrieval configuration is invalid.')
  }
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
  const publishComposerMutation = useMutation(
    consoleQuery.agent.byAgentId.composer.put.mutationOptions(),
  )

  const saveComposer = useSerialAsyncCallback(async (
    saveStrategy: ComposerSaveStrategy,
    configSnapshot: AgentSoulConfig,
  ) => {
    const savedDraftKey = JSON.stringify(configSnapshot)
    const composerMutation = saveStrategy === 'save_as_new_version'
      ? publishComposerMutation
      : saveComposerMutation
    let composerState: Awaited<ReturnType<typeof composerMutation.mutateAsync>>

    try {
      composerState = await composerMutation.mutateAsync({
        params: {
          agent_id: agentId,
        },
        body: {
          variant: 'agent_app',
          save_strategy: saveStrategy,
          agent_soul: configSnapshot,
        },
      })
    }
    catch {
      // Draft sync follows workflow autosave behavior: save failures are silent and keep the local draft intact.
      return
    }

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
    const draft = store.get(agentComposerDraftAtom)
    if (!validateKnowledgeRetrievals(draft.knowledgeRetrievals).isValid)
      return

    void saveComposer('save_to_current_version', getAgentSoulDraft())
  }

  const debouncedSaveDraft = useMemo(() => debounce(() => {
    latestDraftSaveRef.current()
  }, DRAFT_AUTOSAVE_WAIT), [])

  const saveDraft = useCallback(async () => {
    if (!enabledRef.current)
      return

    const draft = store.get(agentComposerDraftAtom)
    if (!validateKnowledgeRetrievals(draft.knowledgeRetrievals).isValid)
      throw new InvalidKnowledgeConfigurationError()

    debouncedSaveDraft.cancel?.()
    await saveComposer('save_to_current_version', getAgentSoulDraft())
  }, [debouncedSaveDraft, getAgentSoulDraft, saveComposer, store])

  useEffect(() => {
    return store.sub(agentComposerDraftAtom, () => {
      const agentSoulDraft = getAgentSoulDraft()
      const agentSoulDraftKey = JSON.stringify(agentSoulDraft)

      if (
        !enabledRef.current
        || !store.get(isAgentComposerDirtyAtom)
        || !validateKnowledgeRetrievals(store.get(agentComposerDraftAtom).knowledgeRetrievals).isValid
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

  const publishDraft = useCallback(async () => {
    const draft = store.get(agentComposerDraftAtom)
    if (!validateKnowledgeRetrievals(draft.knowledgeRetrievals).isValid)
      throw new InvalidKnowledgeConfigurationError()

    debouncedSaveDraft.cancel?.()
    await saveComposer('save_as_new_version', formStateToAgentSoulConfig({
      baseConfig: baseConfigRef.current,
      formState: draft,
      currentModel: currentModelRef.current,
    }))
  }, [debouncedSaveDraft, saveComposer, store])

  return {
    draftSavedAt,
    isPublishing: publishComposerMutation.isPending,
    publishDraft,
    saveDraft,
  }
}
