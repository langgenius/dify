import type {
  AgentConfigFileRefConfig,
  AgentConfigSkillRefConfig,
  AgentKnowledgeMetadataConditions,
  AgentKnowledgeModelConfig,
  AgentKnowledgeRetrievalConfig,
  AgentKnowledgeSetConfig,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import type {
  AgentCliTool,
  AgentComposerModel,
  AgentFileNode,
  AgentKnowledgeRetrievalItem,
  AgentProviderTool,
  AgentSkill,
  AgentSoulConfigFormState,
  AgentTool,
  EnvVariable,
} from './form-state'
import type {
  MetadataFilteringConditions,
  MultipleRetrievalConfig,
  SingleRetrievalConfig,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { ModelConfig } from '@/app/components/workflow/types'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { DATASET_DEFAULT } from '@/config'
import { getFileIconType } from '@/features/agent-v2/agent-detail/configure/components/orchestrate/files/file-icon'
import { RETRIEVE_TYPE } from '@/types/app'
import { checkKey } from '@/utils/var'
import { defaultAgentSoulConfigFormState } from './form-state'
import { getKnowledgeRetrievalSetName } from './knowledge-validation'

type AgentSoulDifyToolConfig = NonNullable<NonNullable<AgentSoulConfig['tools']>['dify_tools']>[number]
type AgentSoulCliToolConfig = NonNullable<NonNullable<AgentSoulConfig['tools']>['cli_tools']>[number]
type AgentSoulToolRuntimeParameterValue = NonNullable<AgentSoulDifyToolConfig['runtime_parameters']>[string]
type AgentSoulEnvVariableConfig = NonNullable<NonNullable<AgentSoulConfig['env']>['variables']>[number]

const toKnowledgeDatasetRefs = (item: AgentKnowledgeRetrievalItem) => {
  if (item.selectedDatasets !== undefined) {
    return item.selectedDatasets.map(dataset => ({
      description: dataset.description,
      id: dataset.id,
      name: dataset.name,
    }))
  }

  return item.datasetRefs ?? []
}

const toRetrievalConfig = (item: AgentKnowledgeRetrievalItem): AgentKnowledgeRetrievalConfig => {
  if (item.retrievalMode === RETRIEVE_TYPE.oneWay) {
    return {
      mode: 'single',
      model: item.singleRetrievalConfig?.model,
    }
  }

  const config = item.multipleRetrievalConfig
  return {
    mode: 'multiple',
    top_k: config?.top_k ?? DATASET_DEFAULT.top_k,
    score_threshold: config?.score_threshold ?? undefined,
    reranking_mode: config?.reranking_mode,
    reranking_enable: config?.reranking_enable ?? false,
    reranking_model: config?.reranking_model,
    weights: config?.weights,
  }
}

const toModelFormState = (model?: AgentKnowledgeModelConfig | null): ModelConfig | undefined => {
  if (!model)
    return undefined

  return {
    provider: model.provider,
    name: model.name,
    mode: model.mode,
    completion_params: model.completion_params ?? {},
  }
}

const toMultipleRetrievalFormState = (config?: AgentKnowledgeRetrievalConfig): MultipleRetrievalConfig => ({
  top_k: config?.top_k ?? DATASET_DEFAULT.top_k,
  score_threshold: config?.score_threshold ?? null,
  reranking_model: config?.reranking_model ?? undefined,
  reranking_mode: config?.reranking_mode as MultipleRetrievalConfig['reranking_mode'],
  weights: config?.weights as MultipleRetrievalConfig['weights'],
  reranking_enable: config?.reranking_enable ?? false,
})

const toSingleRetrievalFormState = (config?: AgentKnowledgeRetrievalConfig): SingleRetrievalConfig | undefined => (
  config?.model
    ? {
        model: toModelFormState(config.model)!,
      }
    : undefined
)

const toMetadataFilteringConfig = (item: AgentKnowledgeRetrievalItem): AgentKnowledgeSetConfig['metadata_filtering'] => {
  const mode = item.metadataFilterMode ?? MetadataFilteringModeEnum.disabled

  return {
    mode,
    model_config: mode === MetadataFilteringModeEnum.automatic ? item.metadataModelConfig : undefined,
    conditions: mode === MetadataFilteringModeEnum.manual
      ? item.metadataFilteringConditions as AgentKnowledgeMetadataConditions | undefined
      : undefined,
  }
}

const toKnowledgeSets = (knowledgeRetrievals: AgentKnowledgeRetrievalItem[]): AgentKnowledgeSetConfig[] => knowledgeRetrievals.map(item => ({
  id: item.id,
  name: getKnowledgeRetrievalSetName(item),
  description: item.description,
  datasets: toKnowledgeDatasetRefs(item),
  query: {
    mode: item.queryMode === 'custom' ? ('user_query' as const) : ('generated_query' as const),
    value: item.queryMode === 'custom' ? (item.customQuery?.trim() || undefined) : undefined,
  },
  retrieval: toRetrievalConfig(item),
  metadata_filtering: toMetadataFilteringConfig(item),
}))

const toKnowledgeRetrievalFormState = (config?: AgentSoulConfig): AgentKnowledgeRetrievalItem[] => {
  return (config?.knowledge?.sets ?? []).map(knowledgeSet => ({
    id: knowledgeSet.id,
    name: knowledgeSet.name,
    description: knowledgeSet.description ?? undefined,
    queryMode: knowledgeSet.query.mode === 'user_query' ? 'custom' : 'agent',
    customQuery: knowledgeSet.query.value ?? undefined,
    datasetRefs: knowledgeSet.datasets,
    retrievalMode: knowledgeSet.retrieval.mode === 'single' ? RETRIEVE_TYPE.oneWay : RETRIEVE_TYPE.multiWay,
    multipleRetrievalConfig: toMultipleRetrievalFormState(knowledgeSet.retrieval),
    singleRetrievalConfig: toSingleRetrievalFormState(knowledgeSet.retrieval),
    metadataFilterMode: (knowledgeSet.metadata_filtering?.mode ?? MetadataFilteringModeEnum.disabled) as MetadataFilteringModeEnum,
    metadataFilteringConditions: knowledgeSet.metadata_filtering?.conditions as MetadataFilteringConditions | undefined,
    metadataModelConfig: toModelFormState(knowledgeSet.metadata_filtering?.model_config),
  }))
}

const toKnowledgeConfig = (
  knowledgeRetrievals: AgentKnowledgeRetrievalItem[],
): AgentSoulConfig['knowledge'] => ({
  sets: toKnowledgeSets(knowledgeRetrievals),
})

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

const toCredentialVariant = (tool: AgentSoulDifyToolConfig) => {
  const credentialType = tool.credential_type

  if (credentialType === 'api-key')
    return 'authorized' as const

  if (credentialType === 'oauth2')
    return tool.credential_ref?.id ? 'authorized' as const : 'unauthorized' as const

  if (credentialType === 'unauthorized')
    return 'unauthorized' as const

  return 'none' as const
}

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
      allowDelete: tool.credential_type === 'api-key' || tool.credential_type === 'oauth2' || tool.credential_type === 'unauthorized',
      credentialId: tool.credential_ref?.id ?? undefined,
      credentialKey: tool.credential_type === 'api-key' || tool.credential_type === 'oauth2'
        ? 'agentDetail.configure.tools.credential.authOne'
        : undefined,
      credentialType: tool.credential_type,
      credentialVariant: toCredentialVariant(tool),
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
    provider: tool.name,
    provider_id: tool.id,
    provider_type: tool.providerType ?? 'builtin',
    tool_name: action.toolName,
    runtime_parameters: toToolRuntimeParameters(toolSettings[action.id]),
    credential_type: tool.credentialType ?? (tool.credentialVariant === 'authorized' ? 'api-key' as const : 'unauthorized' as const),
    credential_ref: tool.credentialId
      ? {
          id: tool.credentialId,
          provider: tool.id,
          type: 'provider' as const,
        }
      : undefined,
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
    const value = secret.value ?? secret.ref ?? secret.credential_id ?? ''
    return {
      id: secret.id ?? secret.ref ?? secret.credential_id ?? key,
      key,
      value,
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

const hasValidEnvKey = (variable: EnvVariable) => checkKey(variable.key.trim(), false) === true

const hasEnvValue = (variable: EnvVariable) => variable.value.trim().length > 0

const isPublishablePlainEnvVariable = (variable: EnvVariable) => (
  variable.scope === 'plain' && hasValidEnvKey(variable) && hasEnvValue(variable)
)

const isPublishableSecretEnvVariable = (variable: EnvVariable) => (
  variable.scope === 'secret' && hasValidEnvKey(variable) && hasEnvValue(variable)
)

const toCliToolConfigs = (tools: AgentTool[]) => tools.flatMap((tool) => {
  if (tool.kind !== 'cli')
    return []

  const envVariables = tool.envVariables ?? []

  return [{
    enabled: false,
    env: {
      variables: envVariables
        .filter(isPublishablePlainEnvVariable)
        .map(variable => ({
          id: variable.id,
          key: variable.key.trim(),
          name: variable.key.trim(),
          value: variable.value,
          variable: variable.key.trim(),
        })),
      secret_refs: envVariables
        .filter(isPublishableSecretEnvVariable)
        .map(variable => ({
          id: variable.id,
          key: variable.key.trim(),
          name: variable.key.trim(),
          value: variable.value,
          variable: variable.key.trim(),
        })),
    },
    install_command: tool.installCommand,
    install_commands: tool.installCommand ? [tool.installCommand] : [],
    name: tool.name,
    tool_name: tool.id,
    pre_authorized: false,
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
    const value = secret.value ?? secret.ref ?? secret.credential_id ?? ''
    return {
      id: secret.id ?? secret.ref ?? secret.credential_id ?? key,
      key,
      value,
      scope: 'secret',
      masked: true,
    }
  }),
].filter(variable => variable.key)

const toEnvConfig = (variables: EnvVariable[]): AgentSoulConfig['env'] => ({
  variables: variables
    .filter(isPublishablePlainEnvVariable)
    .map(variable => ({
      id: variable.id,
      key: variable.key.trim(),
      name: variable.key.trim(),
      value: variable.value,
      variable: variable.key.trim(),
    })),
  secret_refs: variables
    .filter(isPublishableSecretEnvVariable)
    .map(variable => ({
      id: variable.id,
      key: variable.key.trim(),
      name: variable.key.trim(),
      value: variable.value,
      variable: variable.key.trim(),
    })),
})

const toConfigSkillConfigs = (skills: AgentSkill[], baseConfig?: AgentSoulConfig): AgentConfigSkillRefConfig[] => {
  const existingByName = new Map((baseConfig?.config_skills ?? []).map(skill => [skill.name, skill]))

  return skills.flatMap((skill) => {
    const existing = existingByName.get(skill.name)
    const fileId = skill.fileId ?? existing?.file_id
    if (!fileId)
      return []

    return [{
      name: skill.name,
      description: skill.description ?? existing?.description ?? '',
      file_id: fileId,
      file_kind: existing?.file_kind ?? 'tool_file',
      size: skill.size ?? existing?.size,
      hash: skill.hash ?? existing?.hash,
      mime_type: skill.mimeType ?? existing?.mime_type,
    }]
  })
}

const toConfigFileConfigs = (files: AgentFileNode[], baseConfig?: AgentSoulConfig): AgentConfigFileRefConfig[] => {
  const existingByName = new Map((baseConfig?.config_files ?? []).map(file => [file.name, file]))

  return files.flatMap((file) => {
    if (file.children?.length)
      return toConfigFileConfigs(file.children, baseConfig)

    const configName = file.configName ?? file.name
    const existing = existingByName.get(configName)
    const fileId = file.fileId ?? existing?.file_id
    if (!fileId)
      return []

    return [{
      name: configName,
      file_id: fileId,
      file_kind: existing?.file_kind ?? 'upload_file',
      size: file.size ?? existing?.size,
      hash: file.hash ?? existing?.hash,
      mime_type: file.mimeType ?? existing?.mime_type,
    }]
  })
}

const toSkillFormState = (config?: AgentSoulConfig): AgentSkill[] => {
  return (config?.config_skills ?? []).map(skill => ({
    id: skill.name,
    name: skill.name,
    description: skill.description ?? undefined,
    fileId: skill.file_id,
    size: skill.size ?? undefined,
    hash: skill.hash ?? undefined,
    mimeType: skill.mime_type ?? undefined,
  }))
}

const toFileFormState = (config?: AgentSoulConfig): AgentFileNode[] => {
  return (config?.config_files ?? []).map(file => ({
    id: file.name,
    name: file.name,
    icon: getFileIconType(file.name, file.mime_type ?? undefined),
    fileId: file.file_id,
    configName: file.name,
    size: file.size ?? undefined,
    hash: file.hash ?? undefined,
    mimeType: file.mime_type ?? undefined,
  }))
}

const toDraftModel = (config?: AgentSoulConfig): AgentComposerModel | undefined => {
  const modelProvider = config?.model?.model_provider
  const model = config?.model?.model

  if (!modelProvider || !model)
    return undefined

  return {
    provider: modelProvider,
    model,
    plugin_id: config?.model?.plugin_id,
    model_settings: config?.model?.model_settings,
  }
}

const getModelProviderPluginId = (model: AgentComposerModel, baseModel?: AgentSoulConfig['model']) => {
  if (model.plugin_id)
    return model.plugin_id

  if (baseModel?.model_provider === model.provider && baseModel.plugin_id)
    return baseModel.plugin_id

  const [organization, pluginName] = model.provider.split('/').filter(Boolean)

  if (organization && pluginName)
    return `${organization}/${pluginName}`

  return model.provider ? `langgenius/${model.provider}` : ''
}

export const formStateToAgentSoulConfig = ({
  baseConfig,
  formState,
  currentModel,
}: {
  baseConfig?: AgentSoulConfig
  formState: AgentSoulConfigFormState
  currentModel?: AgentComposerModel
}): AgentSoulConfig => {
  return {
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
          plugin_id: getModelProviderPluginId(currentModel, baseConfig?.model),
          model_settings: currentModel.model_settings,
        }
      : baseConfig?.model,
    tools: {
      ...baseConfig?.tools,
      dify_tools: toDifyToolConfigs(formState.tools, formState.toolSettings),
      cli_tools: toCliToolConfigs(formState.tools),
    },
    app_features: formState.appFeatures ?? baseConfig?.app_features,
    knowledge: toKnowledgeConfig(formState.knowledgeRetrievals),
    env: toEnvConfig(formState.envVariables),
    config_skills: toConfigSkillConfigs(formState.skills, baseConfig),
    config_files: toConfigFileConfigs(formState.files, baseConfig),
    config_note: baseConfig?.config_note ?? '',
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
