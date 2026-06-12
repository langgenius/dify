import type { AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import type { AgentFileNode, AgentKnowledgeRetrievalItem } from '../agent-detail/configure/components/data'
import type { EnvVariable } from '../agent-detail/configure/components/orchestrate/advanced/env'
import type { AgentSkill } from '../agent-detail/configure/components/orchestrate/skills/item'
import type { AgentTool } from '../agent-detail/configure/components/orchestrate/tools/types'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import isEqual from 'fast-deep-equal'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

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
  skills: [],
  files: [],
  tools: [],
  knowledgeRetrievals: [],
  envVariables: [],
  toolSettings: {},
}

export const agentComposerOriginalConfigAtom = atom<AgentSoulConfig | undefined>(undefined)
export const agentComposerOriginalDraftAtom = atom<AgentComposerDraft | undefined>(defaultAgentComposerDraft)
export const agentComposerDraftAtom = atom<AgentComposerDraft>(defaultAgentComposerDraft)

type AgentSoulDifyToolConfig = NonNullable<NonNullable<AgentSoulConfig['tools']>['dify_tools']>[number]
type AgentSoulToolRuntimeParameterValue = NonNullable<AgentSoulDifyToolConfig['runtime_parameters']>[string]

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

const getKnowledgeRetrievalName = (item: AgentKnowledgeRetrievalItem) => item.name ?? item.nameKey ?? item.id

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const createReferenceToken = (kind: string, id: string, label: string) => (
  `[§${kind}:${id}${label ? `:${label}` : ''}§]`
)

const syncReferenceLabels = ({
  prompt,
  kind,
  currentItems,
  nextItems,
}: {
  prompt: string
  kind: string
  currentItems: Array<{ id: string, name: string }>
  nextItems: Array<{ id: string, name: string }>
}) => {
  const currentItemById = new Map(currentItems.map(item => [item.id, item]))

  return nextItems.reduce((nextPrompt, nextItem) => {
    const currentItem = currentItemById.get(nextItem.id)
    if (!currentItem)
      return nextPrompt

    if (currentItem.name === nextItem.name)
      return nextPrompt

    return nextPrompt.replace(
      new RegExp(`\\[§${escapeRegExp(kind)}:${escapeRegExp(nextItem.id)}(?::[^§\\]]*)?§\\]`, 'g'),
      createReferenceToken(kind, nextItem.id, nextItem.name),
    )
  }, prompt)
}

const toReferenceLabelItems = <Item extends { id: string }>(
  items: Item[],
  getName: (item: Item) => string,
) => items.map(item => ({
  id: item.id,
  name: getName(item),
}))

const syncKnowledgeReferenceLabels = ({
  prompt,
  currentRetrievals,
  nextRetrievals,
}: {
  prompt: string
  currentRetrievals: AgentKnowledgeRetrievalItem[]
  nextRetrievals: AgentKnowledgeRetrievalItem[]
}) => syncReferenceLabels({
  prompt,
  kind: 'knowledge',
  currentItems: toReferenceLabelItems(currentRetrievals, getKnowledgeRetrievalName),
  nextItems: toReferenceLabelItems(nextRetrievals, getKnowledgeRetrievalName),
})

const syncCliToolReferenceLabels = ({
  prompt,
  currentTools,
  nextTools,
}: {
  prompt: string
  currentTools: AgentTool[]
  nextTools: AgentTool[]
}) => syncReferenceLabels({
  prompt,
  kind: 'cli_tool',
  currentItems: toReferenceLabelItems(currentTools.filter(tool => tool.kind === 'cli'), tool => tool.name),
  nextItems: toReferenceLabelItems(nextTools.filter(tool => tool.kind === 'cli'), tool => tool.name),
})

const toKnowledgeDatasets = (knowledgeRetrievals: AgentKnowledgeRetrievalItem[]) => knowledgeRetrievals.flatMap((item) => {
  if (item.selectedDatasets?.length) {
    return item.selectedDatasets.map(dataset => ({
      description: dataset.description,
      id: dataset.id,
      name: dataset.name,
    }))
  }

  return [{
    id: item.id,
    name: getKnowledgeRetrievalName(item),
  }]
})

const toKnowledgeConfig = (
  baseKnowledge: AgentSoulConfig['knowledge'],
  knowledgeRetrievals: AgentKnowledgeRetrievalItem[],
): AgentSoulConfig['knowledge'] => {
  const primaryRetrieval = knowledgeRetrievals.find(retrieval =>
    retrieval.queryMode === 'custom'
    || retrieval.customQuery
    || retrieval.multipleRetrievalConfig
    || retrieval.selectedDatasets?.length,
  ) ?? knowledgeRetrievals[0]
  const multipleRetrievalConfig = primaryRetrieval?.multipleRetrievalConfig
  const scoreThreshold = multipleRetrievalConfig?.score_threshold

  return {
    ...baseKnowledge,
    datasets: toKnowledgeDatasets(knowledgeRetrievals),
    query_mode: primaryRetrieval?.queryMode === 'custom' ? 'user_query' : 'generated_query',
    query_config: {
      ...baseKnowledge?.query_config,
      query: primaryRetrieval?.queryMode === 'custom' ? primaryRetrieval.customQuery : null,
      score_threshold: scoreThreshold,
      score_threshold_enabled: scoreThreshold !== undefined && scoreThreshold !== null,
      top_k: multipleRetrievalConfig?.top_k ?? baseKnowledge?.query_config?.top_k,
    },
  }
}

const isToolRuntimeParameterValue = (value: unknown): value is AgentSoulToolRuntimeParameterValue => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return true

  if (!Array.isArray(value))
    return false

  return value.every(item => typeof item === 'string')
    || value.every(item => typeof item === 'number')
    || value.every(item => typeof item === 'boolean')
}

const toToolRuntimeParameters = (settings: Record<string, unknown> | undefined) => {
  const runtimeParameters: Record<string, AgentSoulToolRuntimeParameterValue> = {}

  Object.entries(settings ?? {}).forEach(([key, value]) => {
    if (isToolRuntimeParameterValue(value))
      runtimeParameters[key] = value
  })

  return runtimeParameters
}

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
    provider_type: tool.providerType ?? 'builtin',
    tool_name: action.toolName,
    runtime_parameters: toToolRuntimeParameters(toolSettings[action.id]),
    credential_type: tool.credentialVariant === 'endUser' ? 'oauth2' as const : 'api-key' as const,
  }))
})

const toCliToolConfigs = (tools: AgentTool[]) => tools.flatMap((tool) => {
  if (tool.kind !== 'cli')
    return []

  const envVariables = tool.envVariables ?? []

  return [{
    enabled: true,
    env: {
      variables: envVariables
        .filter(variable => variable.scope === 'plain')
        .map(variable => ({
          id: variable.id,
          key: variable.key,
          name: variable.key,
          value: variable.value,
          variable: variable.key,
        })),
      secret_refs: envVariables
        .filter(variable => variable.scope === 'secret')
        .map(variable => ({
          id: variable.id,
          key: variable.key,
          name: variable.key,
          ref: variable.id,
          variable: variable.key,
        })),
    },
    install_command: tool.installCommand,
    install_commands: tool.installCommand ? [tool.installCommand] : [],
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
  app_features: draft.config?.app_features ?? baseConfig?.app_features,
  knowledge: toKnowledgeConfig(baseConfig?.knowledge, draft.knowledgeRetrievals),
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
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      prompt: syncCliToolReferenceLabels({
        prompt: draft.prompt,
        currentTools: draft.tools,
        nextTools: tools,
      }),
      tools,
    })
  },
)

export const agentComposerKnowledgeRetrievalsAtom = atom(
  get => get(agentComposerDraftAtom).knowledgeRetrievals,
  (get, set, knowledgeRetrievals: AgentKnowledgeRetrievalItem[]) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      prompt: syncKnowledgeReferenceLabels({
        prompt: draft.prompt,
        currentRetrievals: draft.knowledgeRetrievals,
        nextRetrievals: knowledgeRetrievals,
      }),
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
  const originalDraft = get(agentComposerOriginalDraftAtom)
  const draft = get(agentComposerDraftAtom)

  return !isEqual(draft, originalDraft ?? defaultAgentComposerDraft)
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

export const agentComposerDraftFromConfig = (
  config?: AgentSoulConfig,
  baseDraft: AgentComposerDraft = defaultAgentComposerDraft,
): AgentComposerDraft => ({
  ...baseDraft,
  prompt: config?.prompt?.system_prompt ?? '',
  model: toDraftModel(config),
  config,
})

export function useHydrate({
  defaultDraft = defaultAgentComposerDraft,
  instanceKey,
  draft,
  originalConfig,
  waitForDraft,
}: {
  defaultDraft?: AgentComposerDraft
  instanceKey: string
  draft?: AgentComposerDraft
  originalConfig?: AgentSoulConfig
  waitForDraft?: boolean
}) {
  const setOriginalDraft = useSetAtom(agentComposerOriginalDraftAtom)
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
      setDraft(defaultDraft)
    }

    if (waitForDraft && !draft)
      return

    if (hydratedKeyRef.current === instanceKey)
      return

    hydratedKeyRef.current = instanceKey
    setOriginalConfig(originalConfig)
    setOriginalDraft(draft ?? defaultDraft)
    setDraft(draft ?? defaultDraft)
  }, [defaultDraft, draft, instanceKey, originalConfig, setDraft, setOriginalConfig, setOriginalDraft, waitForDraft])
}

export function useHydrateAgentComposerDraft({
  agentId,
  activeVersionId,
  baseDraft = defaultAgentComposerDraft,
  config,
}: {
  agentId: string
  activeVersionId?: string | null
  baseDraft?: AgentComposerDraft
  config?: AgentSoulConfig
}) {
  const routeKey = `${agentId}:${activeVersionId ?? 'draft'}`
  useHydrate({
    defaultDraft: baseDraft,
    instanceKey: routeKey,
    draft: agentComposerDraftFromConfig(config, baseDraft),
    originalConfig: config,
    waitForDraft: !!activeVersionId && !config,
  })
}

export function usePrompt() {
  const [prompt, setPrompt] = useAtom(agentComposerPromptAtom)
  return [prompt, setPrompt] as const
}

export function useModel() {
  const [model, setModel] = useAtom(agentComposerModelAtom)
  return [model, setModel] as const
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
  const [skills, setSkills] = useAtom(agentComposerSkillsAtom)
  return [skills, setSkills] as const
}

export function useFiles() {
  const [files, setFiles] = useAtom(agentComposerFilesAtom)
  return [files, setFiles] as const
}

export function useTools() {
  const [tools, setTools] = useAtom(agentComposerToolsAtom)
  return [tools, setTools] as const
}

export function useKnowledgeRetrievals() {
  const [knowledgeRetrievals, setKnowledgeRetrievals] = useAtom(agentComposerKnowledgeRetrievalsAtom)
  return [knowledgeRetrievals, setKnowledgeRetrievals] as const
}

export function useEnvVariables() {
  const [envVariables, setEnvVariables] = useAtom(agentComposerEnvVariablesAtom)
  return [envVariables, setEnvVariables] as const
}

export function useToolSettings() {
  const [toolSettings, setToolSettings] = useAtom(agentComposerToolSettingsAtom)
  return [toolSettings, setToolSettings] as const
}

const omitToolSettings = (
  toolSettings: AgentComposerDraft['toolSettings'],
  actionIds: string[],
) => {
  const nextToolSettings = { ...toolSettings }

  actionIds.forEach((actionId) => {
    delete nextToolSettings[actionId]
  })

  return nextToolSettings
}

export function useRemoveProviderTool() {
  const setDraft = useSetAtom(agentComposerDraftAtom)

  return useCallback((toolId: string) => {
    setDraft((draft) => {
      const toolToRemove = draft.tools.find(tool => tool.kind === 'provider' && tool.id === toolId)
      const actionIds = toolToRemove?.kind === 'provider'
        ? toolToRemove.actions.map(action => action.id)
        : []

      return {
        ...draft,
        tools: draft.tools.filter(tool => tool.id !== toolId),
        toolSettings: omitToolSettings(draft.toolSettings, actionIds),
      }
    })
  }, [setDraft])
}

export function useRemoveProviderToolAction() {
  const setDraft = useSetAtom(agentComposerDraftAtom)

  return useCallback((toolId: string, actionId: string) => {
    setDraft(draft => ({
      ...draft,
      tools: draft.tools.flatMap((tool) => {
        if (tool.kind !== 'provider' || tool.id !== toolId)
          return [tool]

        const nextActions = tool.actions.filter(action => action.id !== actionId)
        return nextActions.length > 0
          ? [{ ...tool, actions: nextActions }]
          : []
      }),
      toolSettings: omitToolSettings(draft.toolSettings, [actionId]),
    }))
  }, [setDraft])
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
