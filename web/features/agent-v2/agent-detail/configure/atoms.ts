import type { AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import type { EnvVariable } from './components/advanced-settings/env-editor'
import type { AgentFileNode } from './components/agent-files'
import type { AgentSkill } from './components/agent-skills/agent-skill-item'
import type { AgentTool } from './components/agent-tools'
import type { AgentKnowledgeRetrievalItem } from './components/configured-data'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import {
  defaultAgentFiles,
  defaultAgentKnowledgeRetrievals,
  defaultAgentSkills,
  defaultAgentTools,
} from './components/configured-data'

type AgentConfigureDraft = {
  prompt: string
  model?: DefaultModel
  config?: AgentSoulConfig
  skills: AgentSkill[]
  files: AgentFileNode[]
  tools: AgentTool[]
  knowledgeRetrievals: AgentKnowledgeRetrievalItem[]
  envVariables: EnvVariable[]
  toolSettings: Record<string, Record<string, unknown>>
}

const defaultDraft: AgentConfigureDraft = {
  prompt: '',
  skills: defaultAgentSkills,
  files: defaultAgentFiles,
  tools: defaultAgentTools,
  knowledgeRetrievals: defaultAgentKnowledgeRetrievals,
  envVariables: [
    {
      id: 'openai-api-key',
      key: 'OPENAI_API_KEY',
      value: '••••••••••••',
      scope: 'secret',
      masked: true,
    },
    {
      id: 'tender-corpus-id',
      key: 'TENDER_CORPUS_ID',
      value: 'tender-corpus-2025',
      scope: 'plain',
    },
  ],
  toolSettings: {},
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

export const agentConfigureSkillsAtom = atom(
  get => get(draftAtom).skills,
  (get, set, skills: AgentSkill[]) => {
    set(draftAtom, {
      ...get(draftAtom),
      skills,
    })
  },
)

export const agentConfigureFilesAtom = atom(
  get => get(draftAtom).files,
  (get, set, files: AgentFileNode[]) => {
    set(draftAtom, {
      ...get(draftAtom),
      files,
    })
  },
)

export const agentConfigureToolsAtom = atom(
  get => get(draftAtom).tools,
  (get, set, tools: AgentTool[]) => {
    set(draftAtom, {
      ...get(draftAtom),
      tools,
    })
  },
)

export const agentConfigureKnowledgeRetrievalsAtom = atom(
  get => get(draftAtom).knowledgeRetrievals,
  (get, set, knowledgeRetrievals: AgentKnowledgeRetrievalItem[]) => {
    set(draftAtom, {
      ...get(draftAtom),
      knowledgeRetrievals,
    })
  },
)

export const agentConfigureEnvVariablesAtom = atom(
  get => get(draftAtom).envVariables,
  (get, set, envVariables: EnvVariable[]) => {
    set(draftAtom, {
      ...get(draftAtom),
      envVariables,
    })
  },
)

export const agentConfigureToolSettingsAtom = atom(
  get => get(draftAtom).toolSettings,
  (get, set, toolSettings: Record<string, Record<string, unknown>>) => {
    set(draftAtom, {
      ...get(draftAtom),
      toolSettings,
    })
  },
)

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
  ...defaultDraft,
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

export function useAgentConfigureSkills() {
  return useAtom(agentConfigureSkillsAtom)
}

export function useAgentConfigureFiles() {
  return useAtom(agentConfigureFilesAtom)
}

export function useAgentConfigureTools() {
  return useAtom(agentConfigureToolsAtom)
}

export function useAgentConfigureKnowledgeRetrievals() {
  return useAtom(agentConfigureKnowledgeRetrievalsAtom)
}

export function useAgentConfigureEnvVariables() {
  return useAtom(agentConfigureEnvVariablesAtom)
}

export function useAgentConfigureToolSettings() {
  return useAtom(agentConfigureToolSettingsAtom)
}

export function useRemoveAgentConfigureSkill() {
  const setDraft = useSetAtom(draftAtom)
  return useCallback((skillId: string) => {
    setDraft(draft => ({
      ...draft,
      skills: draft.skills.filter(skill => skill.id !== skillId),
    }))
  }, [setDraft])
}
