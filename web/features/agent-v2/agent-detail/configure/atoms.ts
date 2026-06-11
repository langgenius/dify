import type { AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'

type AgentConfigureDraft = {
  prompt: string
  model?: DefaultModel
  config?: AgentSoulConfig
}

const defaultDraft: AgentConfigureDraft = {
  prompt: '',
}

const originalConfigAtom = atom<AgentSoulConfig | undefined>(undefined)
const draftAtom = atom<AgentConfigureDraft>(defaultDraft)

export const agentConfigurePromptAtom = atom(
  get => get(draftAtom).prompt,
  (get, set, prompt: string) => {
    set(draftAtom, {
      ...get(draftAtom),
      prompt,
    })
  },
)

export const agentConfigureModelAtom = atom(
  get => get(draftAtom).model,
  (get, set, model: DefaultModel | undefined) => {
    set(draftAtom, {
      ...get(draftAtom),
      model,
    })
  },
)

export const agentConfigureConfigAtom = atom(get => get(draftAtom).config)

export const isAgentConfigureDirtyAtom = atom((get) => {
  const originalConfig = get(originalConfigAtom)
  const draft = get(draftAtom)

  if (!originalConfig)
    return draft.prompt !== '' || !!draft.model || !!draft.config

  return (
    draft.prompt !== (originalConfig.prompt?.system_prompt ?? '')
    || draft.model?.provider !== originalConfig.model?.model_provider
    || draft.model?.model !== originalConfig.model?.model
  )
})

const toDraftModel = (config?: AgentSoulConfig): DefaultModel | undefined => {
  const modelProvider = config?.model?.model_provider
  const model = config?.model?.model

  if (!modelProvider || !model)
    return undefined

  return {
    provider: modelProvider,
    model,
  }
}

const toDraft = (config?: AgentSoulConfig): AgentConfigureDraft => ({
  prompt: config?.prompt?.system_prompt ?? '',
  model: toDraftModel(config),
  config,
})

export function useHydrateAgentConfigureDraft({
  agentId,
  activeVersionId,
  config,
}: {
  agentId: string
  activeVersionId?: string | null
  config?: AgentSoulConfig
}) {
  const setOriginalConfig = useSetAtom(originalConfigAtom)
  const setDraft = useSetAtom(draftAtom)
  const resetKeyRef = useRef<string | undefined>(undefined)
  const hydratedKeyRef = useRef<string | undefined>(undefined)
  const routeKey = `${agentId}:${activeVersionId ?? 'draft'}`

  useEffect(() => {
    if (resetKeyRef.current !== routeKey) {
      resetKeyRef.current = routeKey
      hydratedKeyRef.current = undefined
      setOriginalConfig(undefined)
      setDraft(defaultDraft)
    }

    if (activeVersionId && !config)
      return

    if (hydratedKeyRef.current === routeKey)
      return

    hydratedKeyRef.current = routeKey
    setOriginalConfig(config)
    setDraft(toDraft(config))
  }, [config, routeKey, setDraft, setOriginalConfig])
}

export function useAgentConfigurePrompt() {
  return useAtom(agentConfigurePromptAtom)
}

export function useAgentConfigureModel() {
  return useAtom(agentConfigureModelAtom)
}

export function useAgentConfigureCurrentModel(defaultModel?: DefaultModel) {
  return useAtomValue(agentConfigureModelAtom) ?? defaultModel
}

export function useAgentConfigureConfig() {
  return useAtomValue(agentConfigureConfigAtom)
}

export function useSetAgentConfigurePrompt() {
  const setPrompt = useSetAtom(agentConfigurePromptAtom)
  return useCallback((prompt: string) => setPrompt(prompt), [setPrompt])
}
