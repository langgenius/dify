import type { AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import type { AgentFileNode, AgentKnowledgeRetrievalItem } from '../agent-detail/configure/components/data'
import type { EnvVariable } from '../agent-detail/configure/components/orchestrate/advanced/env'
import type { AgentSkill } from '../agent-detail/configure/components/orchestrate/skills/item'
import type { AgentCliTool, AgentProviderTool, AgentTool } from '../agent-detail/configure/components/orchestrate/tools/types'
import type { AgentSoulConfigFormState } from './form-state'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { defaultAgentSoulConfigFormState } from './form-state'

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
