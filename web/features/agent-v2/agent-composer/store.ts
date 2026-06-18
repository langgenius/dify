import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentSoulConfigFormState } from './form-state'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import isEqual from 'fast-deep-equal'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef } from 'react'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from './conversions'
import { defaultAgentSoulConfigFormState } from './form-state'

export const agentComposerOriginalConfigAtom = atom<AgentSoulConfig | undefined>(undefined)
export const agentComposerOriginalDraftAtom = atom<AgentSoulConfigFormState | undefined>(defaultAgentSoulConfigFormState)
export const agentComposerPublishedDraftAtom = atom<AgentSoulConfigFormState | undefined>(defaultAgentSoulConfigFormState)
export const agentComposerDraftAtom = atom<AgentSoulConfigFormState>(defaultAgentSoulConfigFormState)

export const isAgentComposerDirtyAtom = atom((get) => {
  const originalDraft = get(agentComposerOriginalDraftAtom)
  const draft = get(agentComposerDraftAtom)

  return !isEqual(draft, originalDraft ?? defaultAgentSoulConfigFormState)
})

const hasAgentComposerUnpublishedChangesAtom = atom((get) => {
  const publishedDraft = get(agentComposerPublishedDraftAtom)
  const draft = get(agentComposerDraftAtom)

  return !isEqual(draft, publishedDraft ?? defaultAgentSoulConfigFormState)
})

function useHydrate({
  defaultDraft = defaultAgentSoulConfigFormState,
  instanceKey,
  draft,
  originalConfig,
  waitForDraft,
}: {
  defaultDraft?: AgentSoulConfigFormState
  instanceKey: string
  draft?: AgentSoulConfigFormState
  originalConfig?: AgentSoulConfig
  waitForDraft?: boolean
}) {
  const setOriginalDraft = useSetAtom(agentComposerOriginalDraftAtom)
  const setPublishedDraft = useSetAtom(agentComposerPublishedDraftAtom)
  const setOriginalConfig = useSetAtom(agentComposerOriginalConfigAtom)
  const setDraft = useSetAtom(agentComposerDraftAtom)
  const resetKeyRef = useRef<string | undefined>(undefined)
  const hydratedKeyRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (resetKeyRef.current !== instanceKey) {
      resetKeyRef.current = instanceKey
      hydratedKeyRef.current = undefined
      setOriginalConfig(undefined)
      setOriginalDraft(defaultDraft)
      setPublishedDraft(defaultDraft)
      setDraft(defaultDraft)
    }

    if (waitForDraft && !draft)
      return

    if (hydratedKeyRef.current === instanceKey)
      return

    hydratedKeyRef.current = instanceKey
    setOriginalConfig(originalConfig)
    setOriginalDraft(draft ?? defaultDraft)
    setPublishedDraft(draft ?? defaultDraft)
    setDraft(draft ?? defaultDraft)
  }, [defaultDraft, draft, instanceKey, originalConfig, setDraft, setOriginalConfig, setOriginalDraft, setPublishedDraft, waitForDraft])
}

export function useHydrateAgentSoulConfigDraft({
  agentId,
  activeVersionId,
  baseDraft = defaultAgentSoulConfigFormState,
  config,
}: {
  agentId: string
  activeVersionId?: string | null
  baseDraft?: AgentSoulConfigFormState
  config?: AgentSoulConfig
}) {
  const routeKey = `${agentId}:${activeVersionId ?? 'draft'}`
  useHydrate({
    defaultDraft: baseDraft,
    instanceKey: routeKey,
    draft: agentSoulConfigToFormState(config, baseDraft),
    originalConfig: config,
    waitForDraft: !!activeVersionId && !config,
  })
}

export function useHasAgentComposerUnpublishedChanges() {
  return useAtomValue(hasAgentComposerUnpublishedChangesAtom)
}

export function useAgentComposerConfigSnapshot({
  baseConfig,
  currentModel,
}: {
  baseConfig?: AgentSoulConfig
  currentModel?: DefaultModel
}) {
  const draft = useAtomValue(agentComposerDraftAtom)

  return useMemo(() => formStateToAgentSoulConfig({
    baseConfig,
    formState: draft,
    currentModel,
  }), [baseConfig, currentModel, draft])
}

export function useConfigPublishPayload({
  agentId,
  baseConfig,
  currentModel,
}: {
  agentId: string
  baseConfig?: AgentSoulConfig
  currentModel?: DefaultModel
}) {
  const configSnapshot = useAgentComposerConfigSnapshot({
    baseConfig,
    currentModel,
  })

  return useMemo(() => ({
    agent_id: agentId,
    config_snapshot: configSnapshot,
  }), [agentId, configSnapshot])
}
