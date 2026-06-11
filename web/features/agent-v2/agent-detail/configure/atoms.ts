import type { AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import type { EnvVariable } from './components/orchestrate/advanced/env'
import type { AgentFileNode, AgentKnowledgeRetrievalItem } from './components/orchestrate/data'
import type { AgentSkill } from './components/orchestrate/skills/item'
import type { AgentTool } from './components/orchestrate/tools'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  defaultAgentFiles,
  defaultAgentKnowledgeRetrievals,
  defaultAgentSkills,
  defaultAgentTools,
} from './components/orchestrate/data'

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

const flattenFileNodes = (files: AgentFileNode[]): AgentFileNode[] => files.flatMap(file => [
  file,
  ...flattenFileNodes(file.children ?? []),
])

const toSkillRefs = (skills: AgentSkill[]) => skills.map(skill => ({
  id: skill.id,
  name: skill.name,
}))

const toFileRefs = (files: AgentFileNode[]) => flattenFileNodes(files).map(file => ({
  id: file.id,
  name: file.name,
  type: file.icon,
}))

const toKnowledgeDatasets = (knowledgeRetrievals: AgentKnowledgeRetrievalItem[]) => knowledgeRetrievals.map(item => ({
  id: item.id,
  name: item.nameKey,
}))

const toDifyToolConfigs = (
  tools: AgentTool[],
  toolSettings: Record<string, Record<string, unknown>>,
) => tools.flatMap((tool) => {
  if (tool.kind !== 'provider')
    return []

  return tool.actions.map(action => ({
    enabled: true,
    name: action.name,
    provider: tool.name,
    provider_id: tool.id,
    provider_type: 'builtin',
    tool_name: action.toolName,
    runtime_parameters: toolSettings[action.id] ?? {},
    credential_type: tool.credentialVariant === 'endUser' ? 'oauth2' as const : 'api-key' as const,
  }))
})

const toCliToolConfigs = (tools: AgentTool[]) => tools.flatMap((tool) => {
  if (tool.kind !== 'cli')
    return []

  return [{
    enabled: true,
    name: tool.name,
    tool_name: tool.id,
    pre_authorized: tool.action === 'preAuthorize',
  }]
})

const toEnvConfig = (variables: EnvVariable[]): AgentSoulConfig['env'] => ({
  variables: variables
    .filter(variable => variable.scope === 'plain')
    .map(variable => ({
      id: variable.id,
      key: variable.key,
      name: variable.key,
      value: variable.value,
      variable: variable.key,
    })),
  secret_refs: variables
    .filter(variable => variable.scope === 'secret')
    .map(variable => ({
      id: variable.id,
      key: variable.key,
      name: variable.key,
      ref: variable.id,
      variable: variable.key,
    })),
})

const toConfigSnapshot = ({
  baseConfig,
  draft,
  currentModel,
}: {
  baseConfig?: AgentSoulConfig
  draft: AgentConfigureDraft
  currentModel?: DefaultModel
}): AgentSoulConfig => ({
  ...baseConfig,
  prompt: {
    ...baseConfig?.prompt,
    system_prompt: draft.prompt,
  },
  model: currentModel
    ? {
        ...baseConfig?.model,
        model_provider: currentModel.provider,
        model: currentModel.model,
        plugin_id: baseConfig?.model?.plugin_id ?? '',
      }
    : baseConfig?.model,
  skills_files: {
    ...baseConfig?.skills_files,
    skills: toSkillRefs(draft.skills),
    files: toFileRefs(draft.files),
  },
  tools: {
    ...baseConfig?.tools,
    dify_tools: toDifyToolConfigs(draft.tools, draft.toolSettings),
    cli_tools: toCliToolConfigs(draft.tools),
  },
  knowledge: {
    ...baseConfig?.knowledge,
    datasets: toKnowledgeDatasets(draft.knowledgeRetrievals),
  },
  env: toEnvConfig(draft.envVariables),
})

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

export function useAgentConfigurePublishPayload({
  agentId,
  baseConfig,
  currentModel,
}: {
  agentId: string
  baseConfig?: AgentSoulConfig
  currentModel?: DefaultModel
}) {
  const draft = useAtomValue(draftAtom)

  return useMemo(() => ({
    agent_id: agentId,
    config_snapshot: toConfigSnapshot({
      baseConfig,
      draft,
      currentModel,
    }),
  }), [agentId, baseConfig, currentModel, draft])
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
