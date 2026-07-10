'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { debounce } from 'es-toolkit/compat'
import isEqual from 'fast-deep-equal'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { useKnowledgeValidationMessage, validateKnowledgeRetrievals } from '@/features/agent-v2/agent-composer/knowledge-validation'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  agentComposerPublishedDraftAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'

const DRAFT_AUTOSAVE_WAIT = 5000

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
  const { t: tCommon } = useTranslation('common')
  const getKnowledgeValidationMessage = useKnowledgeValidationMessage()
  const queryClient = useQueryClient()
  const store = useStore()
  const setOriginalConfig = useSetAtom(agentComposerOriginalConfigAtom)
  const setOriginalDraft = useSetAtom(agentComposerOriginalDraftAtom)
  const setPublishedDraft = useSetAtom(agentComposerPublishedDraftAtom)
  const [draftSavedAt, setDraftSavedAt] = useState<number | undefined>(undefined)
  const [isPublishInFlight, setIsPublishInFlight] = useState(false)
  const baseConfigRef = useRef(baseConfig)
  const currentModelRef = useRef(currentModel)
  const enabledRef = useRef(enabled)
  const lastAutosavedDraftKeyRef = useRef<string | undefined>(undefined)
  const pageCloseSavingDraftKeyRef = useRef<string | undefined>(undefined)
  const publishInFlightRef = useRef(false)

  baseConfigRef.current = baseConfig
  currentModelRef.current = currentModel
  enabledRef.current = enabled

  const getAgentSoulDraft = useCallback(() => formStateToAgentSoulConfig({
    baseConfig: baseConfigRef.current,
    formState: store.get(agentComposerDraftAtom),
    currentModel: currentModelRef.current,
  }), [store])

  const {
    mutateAsync: saveComposerDraft,
  } = useMutation(
    consoleQuery.agent.byAgentId.composer.put.mutationOptions(),
  )
  const {
    isPending: isPublishingAgent,
    mutateAsync: publishAgent,
  } = useMutation(
    consoleQuery.agent.byAgentId.publish.post.mutationOptions(),
  )

  const saveComposer = useSerialAsyncCallback(async ({
    configSnapshot,
    draftBaseline,
    silent = true,
  }: {
    configSnapshot: AgentSoulConfig
    draftBaseline: AgentSoulConfigFormState
    silent?: boolean
  }) => {
    const savedDraftKey = JSON.stringify(configSnapshot)
    const agentDetailQueryKey = consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } })
    try {
      const composerState = await saveComposerDraft({
        params: {
          agent_id: agentId,
        },
        body: {
          variant: 'agent_app',
          save_strategy: 'save_to_current_version',
          agent_soul: configSnapshot,
        },
      })
      queryClient.setQueryData(
        consoleQuery.agent.byAgentId.composer.get.queryKey({ input: { params: { agent_id: agentId } } }),
        composerState,
      )
      await queryClient.invalidateQueries({
        queryKey: agentDetailQueryKey,
      })
    }
    catch {
      // Autosave is silent and keeps the local draft intact; explicit commands must stop at this boundary.
      if (!silent) {
        toast.error(tCommon('api.actionFailed'))
        throw new Error('Failed to save agent composer draft.')
      }

      return false
    }

    setOriginalDraft(draftBaseline)
    setDraftSavedAt(Date.now())
    lastAutosavedDraftKeyRef.current = savedDraftKey
    return true
  })

  const latestDraftSaveRef = useRef<() => void>(() => undefined)
  latestDraftSaveRef.current = () => {
    const draft = store.get(agentComposerDraftAtom)

    void saveComposer({
      configSnapshot: getAgentSoulDraft(),
      draftBaseline: draft,
    })
  }

  const debouncedSaveDraft = useMemo(() => debounce(() => {
    latestDraftSaveRef.current()
  }, DRAFT_AUTOSAVE_WAIT), [])

  const saveDraft = useCallback(async () => {
    if (!enabledRef.current)
      return

    const draft = store.get(agentComposerDraftAtom)
    const configSnapshot = getAgentSoulDraft()
    const hasEffectiveModelChange = !isEqual(configSnapshot.model, baseConfigRef.current?.model)
    debouncedSaveDraft.cancel?.()
    if (!store.get(isAgentComposerDirtyAtom) && !hasEffectiveModelChange)
      return

    await saveComposer({
      configSnapshot,
      draftBaseline: draft,
      silent: false,
    })
  }, [debouncedSaveDraft, getAgentSoulDraft, saveComposer, store])

  const saveDirtyDraftOnPageClose = useCallback(() => {
    if (!enabledRef.current || publishInFlightRef.current) {
      return
    }

    const draft = store.get(agentComposerDraftAtom)
    if (
      !store.get(isAgentComposerDirtyAtom)
    ) {
      return
    }

    const configSnapshot = getAgentSoulDraft()
    const draftKey = JSON.stringify(configSnapshot)
    if (
      lastAutosavedDraftKeyRef.current === draftKey
      || pageCloseSavingDraftKeyRef.current === draftKey
    ) {
      return
    }

    debouncedSaveDraft.cancel?.()
    pageCloseSavingDraftKeyRef.current = draftKey
    void saveComposer({
      configSnapshot,
      draftBaseline: draft,
    }).finally(() => {
      if (pageCloseSavingDraftKeyRef.current === draftKey)
        pageCloseSavingDraftKeyRef.current = undefined
    })
  }, [debouncedSaveDraft, getAgentSoulDraft, saveComposer, store])

  useEffect(() => {
    return store.sub(agentComposerDraftAtom, () => {
      const agentSoulDraft = getAgentSoulDraft()
      const agentSoulDraftKey = JSON.stringify(agentSoulDraft)
      const isDirty = store.get(isAgentComposerDirtyAtom)

      if (
        !enabledRef.current
        || !isDirty
      ) {
        if (!isDirty)
          debouncedSaveDraft.cancel?.()
        return
      }

      if (
        lastAutosavedDraftKeyRef.current === agentSoulDraftKey
      ) {
        return
      }

      debouncedSaveDraft()
    })
  }, [debouncedSaveDraft, getAgentSoulDraft, store])

  useEffect(() => {
    const saveDraftWhenPageHidden = () => {
      if (document.visibilityState === 'hidden')
        saveDirtyDraftOnPageClose()
    }
    const saveDraftBeforeUnload = () => {
      saveDirtyDraftOnPageClose()
    }

    document.addEventListener('visibilitychange', saveDraftWhenPageHidden)
    window.addEventListener('beforeunload', saveDraftBeforeUnload)

    return () => {
      document.removeEventListener('visibilitychange', saveDraftWhenPageHidden)
      window.removeEventListener('beforeunload', saveDraftBeforeUnload)
    }
  }, [saveDirtyDraftOnPageClose])

  useEffect(() => {
    return () => {
      saveDirtyDraftOnPageClose()
    }
  }, [saveDirtyDraftOnPageClose])

  const publishDraft = useCallback(async () => {
    if (publishInFlightRef.current)
      return

    const draft = store.get(agentComposerDraftAtom)
    const configSnapshot = formStateToAgentSoulConfig({
      baseConfig: baseConfigRef.current,
      formState: draft,
      currentModel: currentModelRef.current,
    })
    if (!configSnapshot.model?.model_provider || !configSnapshot.model.model) {
      toast.error(tCommon('modelProvider.selectModel'))
      return
    }

    const knowledgeValidation = validateKnowledgeRetrievals(draft.knowledgeRetrievals)
    if (!knowledgeValidation.isValid) {
      toast.error(getKnowledgeValidationMessage(knowledgeValidation.firstIssue?.code) ?? tCommon('api.actionFailed'))
      return
    }

    publishInFlightRef.current = true
    setIsPublishInFlight(true)
    try {
      debouncedSaveDraft.cancel?.()
      const saved = await saveComposer({
        configSnapshot,
        draftBaseline: draft,
        silent: false,
      })
      if (!saved)
        return

      await publishAgent({
        params: {
          agent_id: agentId,
        },
        body: {},
      })
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
        queryKey: consoleQuery.agent.byAgentId.composer.get.queryKey({ input: { params: { agent_id: agentId } } }),
      })
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.agent.byAgentId.versions.get.key(),
      })
      setOriginalConfig(configSnapshot)
      const publishedDraft = draft
      setOriginalDraft(publishedDraft)
      setPublishedDraft(publishedDraft)
      toast.success(tCommon('api.actionSuccess'))
    }
    finally {
      publishInFlightRef.current = false
      setIsPublishInFlight(false)
    }
  }, [agentId, debouncedSaveDraft, getKnowledgeValidationMessage, publishAgent, queryClient, saveComposer, setOriginalConfig, setOriginalDraft, setPublishedDraft, store, tCommon])

  return {
    draftSavedAt,
    isPublishing: isPublishInFlight || isPublishingAgent,
    publishDraft,
    saveDraft,
  }
}
