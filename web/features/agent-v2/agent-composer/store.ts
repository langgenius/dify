import type { AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import type { AgentFileNode, AgentKnowledgeRetrievalItem } from '../agent-detail/configure/components/data'
import type { EnvVariable } from '../agent-detail/configure/components/orchestrate/advanced/env'
import type { AgentSkill } from '../agent-detail/configure/components/orchestrate/skills/item'
import type { AgentTool } from '../agent-detail/configure/components/orchestrate/tools'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  defaultAgentFiles,
  defaultAgentKnowledgeRetrievals,
  defaultAgentSkills,
  defaultAgentTools,
} from '../agent-detail/configure/components/data'

export type AgentComposerDraft = {
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

export const defaultAgentComposerDraft: AgentComposerDraft = {
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

export const agentComposerOriginalConfigAtom = atom<AgentSoulConfig | undefined>(undefined)
export const agentComposerDraftAtom = atom<AgentComposerDraft>(defaultAgentComposerDraft)

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
  draft: AgentComposerDraft
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

export const agentComposerPromptAtom = atom(
  get => get(agentComposerDraftAtom).prompt,
  (get, set, prompt: string) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      prompt,
    })
  },
)

export const agentComposerModelAtom = atom(
  get => get(agentComposerDraftAtom).model,
  (get, set, model: DefaultModel | undefined) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      model,
    })
  },
)

export const agentComposerConfigAtom = atom(get => get(agentComposerDraftAtom).config)

export const agentComposerSkillsAtom = atom(
  get => get(agentComposerDraftAtom).skills,
  (get, set, skills: AgentSkill[]) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      skills,
    })
  },
)

export const agentComposerFilesAtom = atom(
  get => get(agentComposerDraftAtom).files,
  (get, set, files: AgentFileNode[]) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      files,
    })
  },
)

export const agentComposerToolsAtom = atom(
  get => get(agentComposerDraftAtom).tools,
  (get, set, tools: AgentTool[]) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      tools,
    })
  },
)

export const agentComposerKnowledgeRetrievalsAtom = atom(
  get => get(agentComposerDraftAtom).knowledgeRetrievals,
  (get, set, knowledgeRetrievals: AgentKnowledgeRetrievalItem[]) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      knowledgeRetrievals,
    })
  },
)

export const agentComposerEnvVariablesAtom = atom(
  get => get(agentComposerDraftAtom).envVariables,
  (get, set, envVariables: EnvVariable[]) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      envVariables,
    })
  },
)

export const agentComposerToolSettingsAtom = atom(
  get => get(agentComposerDraftAtom).toolSettings,
  (get, set, toolSettings: Record<string, Record<string, unknown>>) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      toolSettings,
    })
  },
)

export const isAgentComposerDirtyAtom = atom((get) => {
  const originalConfig = get(agentComposerOriginalConfigAtom)
  const draft = get(agentComposerDraftAtom)

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

export const agentComposerDraftFromConfig = (config?: AgentSoulConfig): AgentComposerDraft => ({
  ...defaultAgentComposerDraft,
  prompt: config?.prompt?.system_prompt ?? '',
  model: toDraftModel(config),
  config,
})

export function useHydrate({
  instanceKey,
  draft,
  originalConfig,
  waitForDraft,
}: {
  instanceKey: string
  draft?: AgentComposerDraft
  originalConfig?: AgentSoulConfig
  waitForDraft?: boolean
}) {
  const setOriginalConfig = useSetAtom(agentComposerOriginalConfigAtom)
  const setDraft = useSetAtom(agentComposerDraftAtom)
  const resetKeyRef = useRef<string | undefined>(undefined)
  const hydratedKeyRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (resetKeyRef.current !== instanceKey) {
      resetKeyRef.current = instanceKey
      hydratedKeyRef.current = undefined
      setOriginalConfig(undefined)
      setDraft(defaultAgentComposerDraft)
    }

    if (waitForDraft && !draft)
      return

    if (hydratedKeyRef.current === instanceKey)
      return

    hydratedKeyRef.current = instanceKey
    setOriginalConfig(originalConfig)
    setDraft(draft ?? defaultAgentComposerDraft)
  }, [draft, instanceKey, originalConfig, setDraft, setOriginalConfig, waitForDraft])
}

export function useHydrateAgentComposerDraft({
  agentId,
  activeVersionId,
  config,
}: {
  agentId: string
  activeVersionId?: string | null
  config?: AgentSoulConfig
}) {
  const routeKey = `${agentId}:${activeVersionId ?? 'draft'}`
  useHydrate({
    instanceKey: routeKey,
    draft: agentComposerDraftFromConfig(config),
    originalConfig: config,
    waitForDraft: !!activeVersionId && !config,
  })
}

export function usePrompt() {
  return useAtom(agentComposerPromptAtom)
}

export function useModel() {
  return useAtom(agentComposerModelAtom)
}

export function useCurrentModel(defaultModel?: DefaultModel) {
  return useAtomValue(agentComposerModelAtom) ?? defaultModel
}

export function useConfig() {
  return useAtomValue(agentComposerConfigAtom)
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
  const draft = useAtomValue(agentComposerDraftAtom)

  return useMemo(() => ({
    agent_id: agentId,
    config_snapshot: toConfigSnapshot({
      baseConfig,
      draft,
      currentModel,
    }),
  }), [agentId, baseConfig, currentModel, draft])
}

export function useSkills() {
  return useAtom(agentComposerSkillsAtom)
}

export function useFiles() {
  return useAtom(agentComposerFilesAtom)
}

export function useTools() {
  return useAtom(agentComposerToolsAtom)
}

export function useKnowledgeRetrievals() {
  return useAtom(agentComposerKnowledgeRetrievalsAtom)
}

export function useEnvVariables() {
  return useAtom(agentComposerEnvVariablesAtom)
}

export function useToolSettings() {
  return useAtom(agentComposerToolSettingsAtom)
}

export function useRemoveSkill() {
  const setDraft = useSetAtom(agentComposerDraftAtom)
  return useCallback((skillId: string) => {
    setDraft(draft => ({
      ...draft,
      skills: draft.skills.filter(skill => skill.id !== skillId),
    }))
  }, [setDraft])
}
