'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { toast } from '@langgenius/dify-ui/toast'
import { mutationOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { debounce } from 'es-toolkit/compat'
import isEqual from 'fast-deep-equal'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { useSerialAsyncCallback } from '@/app/components/workflow/hooks/use-serial-async-callback'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import {
  useKnowledgeValidationMessage,
  validateKnowledgeRetrievals,
} from '@/features/agent-v2/agent-composer/knowledge-validation'
import {
  agentComposerDraftAtom,
  agentComposerSavedDraftAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'

const DRAFT_AUTOSAVE_WAIT = 5000

export function useAgentConfigureSync({
  agentId,
  agentName,
  baseConfig,
  currentModel,
  enabled,
}: {
  agentId: string
  agentName?: string | null
  baseConfig?: AgentSoulConfig
  currentModel?: DefaultModel
  enabled: boolean
}) {
  const { t: tCommon } = useTranslation('common')
  const getKnowledgeValidationMessage = useKnowledgeValidationMessage()
  const queryClient = useQueryClient()
  const store = useStore()
  const setSavedDraft = useSetAtom(agentComposerSavedDraftAtom)
  const baseConfigRef = useRef(baseConfig)
  const currentModelRef = useRef(currentModel)
  const enabledRef = useRef(enabled)
  const lastAutosavedDraftKeyRef = useRef<string | undefined>(undefined)
  const pageCloseSavingDraftKeyRef = useRef<string | undefined>(undefined)
  const explicitlySavingDraftKeysRef = useRef(new Set<string>())
  const publishInFlightRef = useRef(false)

  baseConfigRef.current = baseConfig
  currentModelRef.current = currentModel
  enabledRef.current = enabled

  const getAgentSoulDraft = useCallback(
    () =>
      formStateToAgentSoulConfig({
        baseConfig: baseConfigRef.current,
        formState: store.get(agentComposerDraftAtom),
        currentModel: currentModelRef.current,
      }),
    [store],
  )

  const { mutateAsync: saveComposerDraft } = useMutation(
    consoleQuery.agent.byAgentId.composer.put.mutationOptions({
      context: {
        silent: true,
      },
    }),
  )
  const { mutateAsync: saveComposerDraftOnPageClose } = useMutation(
    consoleQuery.agent.byAgentId.composer.put.mutationOptions({
      context: {
        keepalive: true,
        silent: true,
      },
    }),
  )
  const { mutateAsync: publishAgent } = useMutation(
    consoleQuery.agent.byAgentId.publish.post.mutationOptions({
      context: {
        silent: true,
      },
    }),
  )

  const saveComposer = useSerialAsyncCallback(
    async ({
      configSnapshot,
      draftBaseline,
      keepalive = false,
      publish = false,
      silent = true,
    }: {
      configSnapshot: AgentSoulConfig
      draftBaseline: AgentSoulConfigFormState
      keepalive?: boolean
      publish?: boolean
      silent?: boolean
    }) => {
      const savedDraftKey = JSON.stringify(configSnapshot)
      try {
        const saveDraftRequest = keepalive ? saveComposerDraftOnPageClose : saveComposerDraft
        await saveDraftRequest({
          params: {
            agent_id: agentId,
          },
          body: {
            variant: 'agent_app',
            save_strategy: 'save_to_current_version',
            agent_soul: configSnapshot,
          },
        })
      } catch {
        // Autosave is silent and keeps the local draft intact; explicit commands must stop at this boundary.
        if (!silent) {
          throw new Error('Failed to save agent composer draft.')
        }

        return false
      }

      setSavedDraft(draftBaseline)
      lastAutosavedDraftKeyRef.current = savedDraftKey

      if (publish) {
        await publishAgent({
          params: {
            agent_id: agentId,
          },
          body: {},
        })
        await queryClient.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.versions.get.key(),
        })
      }

      return true
    },
  )

  const { isPending: isPublishing, mutateAsync: runPublishTransaction } = useMutation(
    mutationOptions({
      mutationKey: ['agent-configure', agentId, 'publish'],
      mutationFn: async ({
        configSnapshot,
        draftBaseline,
      }: {
        configSnapshot: AgentSoulConfig
        draftBaseline: AgentSoulConfigFormState
      }) => {
        await saveComposer({
          configSnapshot,
          draftBaseline,
          publish: true,
          silent: false,
        })
      },
    }),
  )

  const latestDraftSaveRef = useRef<() => void>(() => undefined)
  latestDraftSaveRef.current = () => {
    const draft = store.get(agentComposerDraftAtom)

    void saveComposer({
      configSnapshot: getAgentSoulDraft(),
      draftBaseline: draft,
    })
  }

  const debouncedSaveDraft = useMemo(
    () =>
      debounce(() => {
        latestDraftSaveRef.current()
      }, DRAFT_AUTOSAVE_WAIT),
    [],
  )

  const saveDraft = useCallback(async () => {
    if (!enabledRef.current) return

    const draft = store.get(agentComposerDraftAtom)
    const configSnapshot = getAgentSoulDraft()
    const hasEffectiveModelChange = !isEqual(configSnapshot.model, baseConfigRef.current?.model)
    debouncedSaveDraft.cancel?.()
    if (!store.get(isAgentComposerDirtyAtom) && !hasEffectiveModelChange) return

    const draftKey = JSON.stringify(configSnapshot)
    explicitlySavingDraftKeysRef.current.add(draftKey)
    try {
      await saveComposer({
        configSnapshot,
        draftBaseline: draft,
        silent: false,
      })
    } catch (error) {
      toast.error(tCommon(($) => $['api.actionFailed']))
      throw error
    } finally {
      explicitlySavingDraftKeysRef.current.delete(draftKey)
    }
  }, [debouncedSaveDraft, getAgentSoulDraft, saveComposer, store, tCommon])

  const saveDirtyDraftOnPageClose = useCallback(() => {
    if (!enabledRef.current || publishInFlightRef.current) {
      return
    }

    const draft = store.get(agentComposerDraftAtom)
    if (!store.get(isAgentComposerDirtyAtom)) {
      return
    }

    const configSnapshot = getAgentSoulDraft()
    const draftKey = JSON.stringify(configSnapshot)
    if (
      lastAutosavedDraftKeyRef.current === draftKey ||
      pageCloseSavingDraftKeyRef.current === draftKey ||
      explicitlySavingDraftKeysRef.current.has(draftKey)
    ) {
      return
    }

    debouncedSaveDraft.cancel?.()
    pageCloseSavingDraftKeyRef.current = draftKey
    void saveComposer({
      configSnapshot,
      draftBaseline: draft,
      keepalive: true,
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

      if (!enabledRef.current || publishInFlightRef.current || !isDirty) {
        if (!isDirty) debouncedSaveDraft.cancel?.()
        return
      }

      if (lastAutosavedDraftKeyRef.current === agentSoulDraftKey) {
        return
      }

      debouncedSaveDraft()
    })
  }, [debouncedSaveDraft, getAgentSoulDraft, store])

  useEffect(() => {
    const saveDraftWhenPageHidden = () => {
      if (document.visibilityState === 'hidden') saveDirtyDraftOnPageClose()
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
    if (!enabledRef.current || publishInFlightRef.current) return

    const draft = store.get(agentComposerDraftAtom)
    const configSnapshot = formStateToAgentSoulConfig({
      baseConfig: baseConfigRef.current,
      formState: draft,
      currentModel: currentModelRef.current,
    })
    if (!configSnapshot.model?.model_provider || !configSnapshot.model.model) {
      toast.error(tCommon(($) => $['modelProvider.selectModel']))
      return
    }

    const knowledgeValidation = validateKnowledgeRetrievals(draft.knowledgeRetrievals)
    if (!knowledgeValidation.isValid) {
      toast.error(
        getKnowledgeValidationMessage(knowledgeValidation.firstIssue?.code) ??
          tCommon(($) => $['api.actionFailed']),
      )
      return
    }

    publishInFlightRef.current = true
    try {
      debouncedSaveDraft.cancel?.()
      await runPublishTransaction({
        configSnapshot,
        draftBaseline: draft,
      })
      trackEvent('app_published_time', {
        action_mode: 'app',
        app_id: agentId,
        app_name: agentName,
        app_mode: 'agent-v2',
      })
      toast.success(tCommon(($) => $['api.actionSuccess']))
    } catch (error) {
      toast.error(tCommon(($) => $['api.actionFailed']))
      throw error
    } finally {
      publishInFlightRef.current = false
      if (enabledRef.current && store.get(isAgentComposerDirtyAtom)) debouncedSaveDraft()
    }
  }, [
    agentId,
    agentName,
    debouncedSaveDraft,
    getKnowledgeValidationMessage,
    runPublishTransaction,
    store,
    tCommon,
  ])

  return {
    isPublishing,
    publishDraft,
    saveDraft,
  }
}
