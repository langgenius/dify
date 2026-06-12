import type { AgentSoulAppFeaturesConfig, AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import type { AgentFileNode, AgentKnowledgeRetrievalItem } from '../agent-detail/configure/components/data'
import type { EnvVariable } from '../agent-detail/configure/components/orchestrate/advanced/env'
import type { AgentSkill } from '../agent-detail/configure/components/orchestrate/skills/item'
import type { AgentCliTool, AgentProviderTool, AgentTool } from '../agent-detail/configure/components/orchestrate/tools/types'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import isEqual from 'fast-deep-equal'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

export type AgentSoulConfigFormState = {
  prompt: string
  model?: DefaultModel
  appFeatures?: AgentSoulAppFeaturesConfig
  skills: AgentSkill[]
  files: AgentFileNode[]
  tools: AgentTool[]
  knowledgeRetrievals: AgentKnowledgeRetrievalItem[]
  envVariables: EnvVariable[]
  toolSettings: Record<string, Record<string, unknown>>
}

export const defaultAgentSoulConfigFormState: AgentSoulConfigFormState = {
  prompt: '',
  skills: [],
  files: [],
  tools: [],
  knowledgeRetrievals: [],
  envVariables: [],
  toolSettings: {},
}

export const agentComposerOriginalConfigAtom = atom<AgentSoulConfig | undefined>(undefined)
export const agentComposerOriginalDraftAtom = atom<AgentSoulConfigFormState | undefined>(defaultAgentSoulConfigFormState)
export const agentComposerDraftAtom = atom<AgentSoulConfigFormState>(defaultAgentSoulConfigFormState)

type AgentSoulDifyToolConfig = NonNullable<NonNullable<AgentSoulConfig['tools']>['dify_tools']>[number]
type AgentSoulCliToolConfig = NonNullable<NonNullable<AgentSoulConfig['tools']>['cli_tools']>[number]
type AgentSoulToolRuntimeParameterValue = NonNullable<AgentSoulDifyToolConfig['runtime_parameters']>[string]
type AgentSoulFileRefConfig = NonNullable<NonNullable<AgentSoulConfig['skills_files']>['files']>[number]
type AgentSoulEnvVariableConfig = NonNullable<NonNullable<AgentSoulConfig['env']>['variables']>[number]

const flattenFileNodes = (files: AgentFileNode[]): AgentFileNode[] => files.flatMap(file => [
  file,
  ...flattenFileNodes(file.children ?? []),
])

const toSkillRefs = (skills: AgentSkill[]) => skills.map(skill => ({
  id: skill.id,
  name: skill.name,
}))

const toSkillFormState = (config?: AgentSoulConfig): AgentSkill[] => (
  config?.skills_files?.skills ?? []
).flatMap((skill) => {
  const id = skill.id ?? skill.file_id ?? skill.path
  if (!id)
    return []

  return [{
    id,
    name: skill.name ?? id,
  }]
})

const toFileIcon = (file: AgentSoulFileRefConfig): AgentFileNode['icon'] => {
  const type = file.type?.toLowerCase()

  if (type === 'image' || type === 'pdf' || type === 'markdown' || type === 'json' || type === 'table' || type === 'archive' || type === 'code' || type === 'text' || type === 'folder')
    return type

  return 'file'
}

const toFileFormState = (config?: AgentSoulConfig): AgentFileNode[] => (
  config?.skills_files?.files ?? []
).flatMap((file) => {
  const id = file.id ?? file.file_id ?? file.upload_file_id ?? file.reference ?? file.remote_url ?? file.url
  if (!id)
    return []

  return [{
    id,
    name: file.name ?? id,
    icon: toFileIcon(file),
  }]
})

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
  if (item.datasetRefs?.length)
    return item.datasetRefs

  return [{
    id: item.id,
    name: getKnowledgeRetrievalName(item),
  }]
})

const toKnowledgeRetrievalFormState = (config?: AgentSoulConfig): AgentKnowledgeRetrievalItem[] => {
  const knowledge = config?.knowledge
  const datasets = knowledge?.datasets ?? []

  if (!knowledge && datasets.length === 0)
    return []

  return [{
    id: datasets[0]?.id ?? 'knowledge-retrieval',
    name: datasets[0]?.name ?? 'Knowledge Retrieval',
    queryMode: knowledge?.query_mode === 'user_query' ? 'custom' : 'agent',
    customQuery: knowledge?.query_config?.query ?? undefined,
    datasetRefs: datasets,
    multipleRetrievalConfig: {
      top_k: knowledge?.query_config?.top_k ?? 4,
      score_threshold: knowledge?.query_config?.score_threshold ?? null,
      reranking_enable: false,
    },
  }]
}

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

const getDifyToolActionId = (tool: AgentSoulDifyToolConfig) => `${tool.provider_id ?? tool.provider ?? tool.plugin_id ?? 'provider'}:${tool.tool_name ?? tool.name ?? 'tool'}`

const toProviderToolFormState = (config?: AgentSoulConfig): {
  tools: AgentProviderTool[]
  toolSettings: AgentSoulConfigFormState['toolSettings']
} => {
  const toolByProviderId = new Map<string, AgentProviderTool>()
  const toolSettings: AgentSoulConfigFormState['toolSettings'] = {}

  for (const tool of config?.tools?.dify_tools ?? []) {
    const providerId = tool.provider_id ?? tool.provider ?? tool.plugin_id ?? ''
    const toolName = tool.tool_name ?? tool.name ?? ''
    if (!providerId || !toolName)
      continue

    const actionId = getDifyToolActionId(tool)
    const existingTool = toolByProviderId.get(providerId)
    const action = {
      id: actionId,
      name: tool.name ?? toolName,
      toolName,
      description: tool.description ?? '',
    }

    toolSettings[actionId] = tool.runtime_parameters ?? {}

    if (existingTool) {
      existingTool.actions.push(action)
      continue
    }

    toolByProviderId.set(providerId, {
      id: providerId,
      name: tool.provider ?? providerId,
      kind: 'provider',
      iconClassName: 'i-custom-public-other-default-tool-icon text-text-tertiary',
      providerType: tool.provider_type,
      credentialKey: tool.credential_type === 'oauth2'
        ? 'agentDetail.configure.tools.credential.endUserOAuth'
        : 'agentDetail.configure.tools.credential.authOne',
      credentialVariant: tool.credential_type === 'oauth2' ? 'endUser' : 'authorized',
      actions: [action],
    })
  }

  return {
    tools: Array.from(toolByProviderId.values()),
    toolSettings,
  }
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

const toEnvVariableValue = (variable: AgentSoulEnvVariableConfig) => {
  const value = variable.value ?? variable.default ?? ''
  if (value === null)
    return ''

  if (typeof value === 'string')
    return value

  return JSON.stringify(value)
}

const toCliEnvVariables = (tool: AgentSoulCliToolConfig): EnvVariable[] => [
  ...(tool.env?.variables ?? []).map((variable): EnvVariable => {
    const key = variable.key ?? variable.name ?? variable.variable ?? variable.env_name ?? ''
    return {
      id: variable.env_name ?? variable.key ?? variable.name ?? variable.variable ?? key,
      key,
      value: toEnvVariableValue(variable),
      scope: 'plain',
    }
  }),
  ...(tool.env?.secret_refs ?? []).map((secret): EnvVariable => {
    const key = secret.key ?? secret.name ?? secret.variable ?? secret.env_name ?? ''
    return {
      id: secret.id ?? secret.ref ?? secret.credential_id ?? key,
      key,
      value: '••••••••••••',
      scope: 'secret',
      masked: true,
    }
  }),
].filter(variable => variable.key)

const toCliToolFormState = (config?: AgentSoulConfig): AgentCliTool[] => (
  config?.tools?.cli_tools ?? []
).flatMap((tool) => {
  const id = tool.tool_name ?? tool.id ?? tool.name
  if (!id)
    return []

  return [{
    id,
    name: tool.name ?? tool.label ?? tool.tool_name ?? id,
    kind: 'cli',
    action: tool.pre_authorized ? 'preAuthorize' : undefined,
    installCommand: tool.install_command ?? tool.install_commands?.[0] ?? tool.install ?? tool.setup_command ?? undefined,
    envVariables: toCliEnvVariables(tool),
  }]
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

const toEnvVariableFormState = (config?: AgentSoulConfig): EnvVariable[] => [
  ...(config?.env?.variables ?? []).map((variable): EnvVariable => {
    const key = variable.key ?? variable.name ?? variable.variable ?? variable.env_name ?? ''
    return {
      id: variable.env_name ?? variable.key ?? variable.name ?? variable.variable ?? key,
      key,
      value: toEnvVariableValue(variable),
      scope: 'plain',
    }
  }),
  ...(config?.env?.secret_refs ?? []).map((secret): EnvVariable => {
    const key = secret.key ?? secret.name ?? secret.variable ?? secret.env_name ?? ''
    return {
      id: secret.id ?? secret.ref ?? secret.credential_id ?? key,
      key,
      value: '••••••••••••',
      scope: 'secret',
      masked: true,
    }
  }),
].filter(variable => variable.key)

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

export const formStateToAgentSoulConfig = ({
  baseConfig,
  formState,
  currentModel,
}: {
  baseConfig?: AgentSoulConfig
  formState: AgentSoulConfigFormState
  currentModel?: DefaultModel
}): AgentSoulConfig => ({
  ...baseConfig,
  prompt: {
    ...baseConfig?.prompt,
    system_prompt: formState.prompt,
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
    skills: toSkillRefs(formState.skills),
    files: toFileRefs(formState.files),
  },
  tools: {
    ...baseConfig?.tools,
    dify_tools: toDifyToolConfigs(formState.tools, formState.toolSettings),
    cli_tools: toCliToolConfigs(formState.tools),
  },
  app_features: formState.appFeatures ?? baseConfig?.app_features,
  knowledge: toKnowledgeConfig(baseConfig?.knowledge, formState.knowledgeRetrievals),
  env: toEnvConfig(formState.envVariables),
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

export const agentComposerAppFeaturesAtom = atom(
  get => get(agentComposerDraftAtom).appFeatures,
  (get, set, appFeatures: AgentSoulAppFeaturesConfig | undefined) => {
    set(agentComposerDraftAtom, {
      ...get(agentComposerDraftAtom),
      appFeatures,
    })
  },
)

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

  return !isEqual(draft, originalDraft ?? defaultAgentSoulConfigFormState)
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

export const agentSoulConfigToFormState = (
  config?: AgentSoulConfig,
  baseDraft: AgentSoulConfigFormState = defaultAgentSoulConfigFormState,
): AgentSoulConfigFormState => {
  const providerToolState = toProviderToolFormState(config)

  return {
    ...baseDraft,
    prompt: config?.prompt?.system_prompt ?? '',
    model: toDraftModel(config),
    appFeatures: config?.app_features,
    skills: toSkillFormState(config),
    files: toFileFormState(config),
    tools: [
      ...providerToolState.tools,
      ...toCliToolFormState(config),
    ],
    knowledgeRetrievals: toKnowledgeRetrievalFormState(config),
    envVariables: toEnvVariableFormState(config),
    toolSettings: providerToolState.toolSettings,
  }
}

export function useHydrate({
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

export function useHydrateAgentSoulConfigFormState({
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

export function useAppFeatures() {
  return useAtomValue(agentComposerAppFeaturesAtom)
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
    config_snapshot: formStateToAgentSoulConfig({
      baseConfig,
      formState: draft,
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
  toolSettings: AgentSoulConfigFormState['toolSettings'],
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
