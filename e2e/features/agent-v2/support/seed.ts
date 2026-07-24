import type {
  AgentKnowledgeDatasetConfig,
  AgentSoulConfig,
  AgentSoulDifyToolConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import type { KnowledgeConfig } from '@dify/contracts/api/console/datasets/types.gen'
import type { ModelType } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SeedContext, SeedResource, SeedTask } from '../../../support/seed'
import { readFile } from 'node:fs/promises'
import { createTestApp } from '../../../support/api/apps'
import { bootstrapMarketplacePlugins } from '../../../support/marketplace-plugins'
import { sleep } from '../../../support/process'
import { blocked, created, skipped, updated, verified } from '../../../support/seed'
import { createTestAgent, saveAgentComposerDraft } from './agent'
import {
  agentBuilderExpectedTokens,
  agentBuilderFixedInputs,
  agentBuilderPreseededResources,
} from './agent-builder-resources'
import {
  getAgentDriveSkills,
  uploadAgentConfigFileToDraft,
  uploadAgentConfigSkillToDraft,
  uploadAgentDriveSkill,
} from './agent-drive'
import {
  createAgentSoulConfigWithKnowledgeDataset,
  createAgentSoulConfigWithModel,
  normalAgentSoulConfig,
} from './agent-soul'
import { isRecord, matchesNameOrLabel } from './fixtures/common'
import { splitToolDisplayName } from './fixtures/tools'
import { agentBuilderTestMaterials, getAgentBuilderTestMaterialPath } from './test-materials'
import { syncAgentV2WorkflowDraft } from './workflow'

type StableModel = {
  name: string
  provider: string
  type: ModelType
}

type ToolResource = SeedResource & {
  providerName: string
  toolName: string
}

const modelCredentialEnv = 'E2E_MODEL_PROVIDER_CREDENTIALS_JSON'
const speechToTextModelProviderEnv = 'E2E_SPEECH_TO_TEXT_MODEL_PROVIDER'
const speechToTextModelNameEnv = 'E2E_SPEECH_TO_TEXT_MODEL_NAME'
const marketplacePluginIdsEnv = 'E2E_MARKETPLACE_PLUGIN_IDS'
const activeModelStatus = 'active'
const stableModelCredentialName = 'E2E Stable Model'
const agentV2MarketplacePluginIds = [
  'langgenius/openai',
  'langgenius/json_process',
  'langgenius/tavily',
]

const getProviderAlias = (provider: string) =>
  provider.split('/').filter(Boolean).at(-1) ?? provider

const matchesProvider = (actual: string, expected: string) =>
  actual === expected || getProviderAlias(actual) === getProviderAlias(expected)

const matchesProviderLabel = (
  provider: { label?: { en_US?: string | null; zh_Hans?: string | null } | null; provider: string },
  expected: string,
) =>
  matchesProvider(provider.provider, expected) ||
  provider.label?.en_US === expected ||
  provider.label?.zh_Hans === expected

const parseModelType = (value: string | undefined, fallback: ModelType): ModelType => {
  const modelType = value?.trim()
  if (!modelType) return fallback

  switch (modelType) {
    case 'llm':
    case 'moderation':
    case 'rerank':
    case 'speech2text':
    case 'text-embedding':
    case 'tts':
      return modelType
    default:
      throw new Error(`Unsupported model type "${modelType}".`)
  }
}

const stableModelConfig = (): StableModel => ({
  name: process.env.E2E_STABLE_MODEL_NAME?.trim() || 'gpt-5-nano',
  provider: process.env.E2E_STABLE_MODEL_PROVIDER?.trim() || 'openai',
  type: parseModelType(process.env.E2E_STABLE_MODEL_TYPE, 'llm'),
})

const agentDecisionModelConfig = (): StableModel => ({
  name: process.env.E2E_AGENT_DECISION_MODEL_NAME?.trim() || 'gpt-5.5',
  provider: process.env.E2E_AGENT_DECISION_MODEL_PROVIDER?.trim() || 'openai',
  type: parseModelType(process.env.E2E_AGENT_DECISION_MODEL_TYPE, 'llm'),
})

const speechToTextModelConfig = (): StableModel => ({
  name: process.env[speechToTextModelNameEnv]?.trim() || 'gpt-4o-mini-transcribe',
  provider: process.env[speechToTextModelProviderEnv]?.trim() || 'openai',
  type: 'speech2text',
})

const parseJsonEnv = (envName: string) => {
  const raw = process.env[envName]?.trim()
  if (!raw) return { ok: false as const, reason: `${envName} is required.` }

  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value)) return { ok: false as const, reason: `${envName} must be a JSON object.` }

    return { ok: true as const, value }
  } catch (error) {
    return {
      ok: false as const,
      reason: `${envName} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

const findModel = async (client: SeedContext['consoleClient'], config: StableModel) => {
  const body = await client.workspaces.current.models.modelTypes.byModelType.get({
    params: { model_type: config.type },
  })
  const provider = body.data.find((item) => matchesProvider(item.provider, config.provider))
  const model = provider?.models.find(
    (item) =>
      item.model === config.name ||
      item.label?.en_US === config.name ||
      item.label?.zh_Hans === config.name,
  )

  if (!provider || !model) return undefined

  return {
    name: model.model,
    provider: provider.provider,
    status: model.status,
    type: config.type,
  }
}

const resolveProvider = async (client: SeedContext['consoleClient'], config: StableModel) => {
  const body = await client.workspaces.current.modelProviders.get({
    query: { model_type: config.type },
  })
  const provider = body.data.find((item) => matchesProviderLabel(item, config.provider))

  return {
    availableProviders: body.data.map((provider) => provider.provider),
    credential: provider?.custom_configuration.available_credentials?.find(
      (credential) => credential.credential_name === stableModelCredentialName,
    ),
    provider: provider?.provider,
  }
}

const selectCustomProviderCredential = async (
  client: SeedContext['consoleClient'],
  provider: string,
  credentialId?: string,
) => {
  if (credentialId) {
    await client.workspaces.current.modelProviders.byProvider.credentials.switch.post({
      body: { credential_id: credentialId },
      params: { provider },
    })
  }

  await client.workspaces.current.modelProviders.byProvider.preferredProviderType.post({
    body: { preferred_provider_type: 'custom' },
    params: { provider },
  })
}

const upsertStableProviderCredential = async (
  client: SeedContext['consoleClient'],
  provider: string,
  credentials: Record<string, unknown>,
  credentialId?: string,
) => {
  if (credentialId) {
    await client.workspaces.current.modelProviders.byProvider.credentials.put({
      body: {
        credential_id: credentialId,
        credentials,
        name: stableModelCredentialName,
      },
      params: { provider },
    })
    return
  }

  await client.workspaces.current.modelProviders.byProvider.credentials.post({
    body: {
      credentials,
      name: stableModelCredentialName,
    },
    params: { provider },
  })
}

const seedModel = async (
  context: SeedContext,
  {
    config,
    title,
  }: {
    config: StableModel
    title: string
  },
) => {
  const existing = await findModel(context.consoleClient, config)
  const resource = {
    id: `${existing?.provider ?? config.provider}/${existing?.name ?? config.name}`,
    kind: 'model',
    name: title,
  }

  if (existing?.status === activeModelStatus) return verified(title, resource)

  if (context.dryRun)
    return skipped(
      title,
      `Would configure ${config.provider}/${config.name} using ${modelCredentialEnv}.`,
    )

  const credentials = parseJsonEnv(modelCredentialEnv)
  if (!credentials.ok)
    return blocked(title, `${config.provider}/${config.name} is not active; ${credentials.reason}`)

  const { availableProviders, credential, provider } = await resolveProvider(
    context.consoleClient,
    config,
  )
  if (!provider) {
    const available = availableProviders.length > 0 ? availableProviders.join(', ') : 'none'
    return blocked(
      title,
      `Provider ${config.provider} was not found in available model providers for ${config.type}. Available providers: ${available}.`,
    )
  }

  try {
    await upsertStableProviderCredential(
      context.consoleClient,
      provider,
      credentials.value,
      credential?.credential_id,
    )
    await selectCustomProviderCredential(context.consoleClient, provider, credential?.credential_id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(`Credential with name '${stableModelCredentialName}' already exists.`))
      return blocked(title, message)

    const refreshed = await resolveProvider(context.consoleClient, config)
    if (!refreshed.provider || !refreshed.credential) {
      return blocked(
        title,
        `Credential ${stableModelCredentialName} already exists for ${provider}, but the seed could not resolve its credential id.`,
      )
    }

    try {
      await upsertStableProviderCredential(
        context.consoleClient,
        refreshed.provider,
        credentials.value,
        refreshed.credential.credential_id,
      )
      await selectCustomProviderCredential(
        context.consoleClient,
        refreshed.provider,
        refreshed.credential.credential_id,
      )
    } catch (retryError) {
      return blocked(title, retryError instanceof Error ? retryError.message : String(retryError))
    }
  }

  const seeded = await findModel(context.consoleClient, config)
  if (seeded?.status !== activeModelStatus) {
    return blocked(
      title,
      `${config.provider}/${config.name} is ${seeded?.status ?? 'missing'} after credential setup.`,
    )
  }

  return updated(title, {
    id: `${seeded.provider}/${seeded.name}`,
    kind: 'model',
    name: title,
  })
}

const seedStableModel = async (context: SeedContext) =>
  seedModel(context, {
    config: stableModelConfig(),
    title: agentBuilderPreseededResources.stableChatModel,
  })

const seedAgentDecisionModel = async (context: SeedContext) =>
  seedModel(context, {
    config: agentDecisionModelConfig(),
    title: agentBuilderPreseededResources.agentDecisionChatModel,
  })

const seedSpeechToTextModel = async (context: SeedContext) => {
  const config = speechToTextModelConfig()
  const title = agentBuilderPreseededResources.speechToTextModel
  const modelResult = await seedModel(context, { config, title })
  if (modelResult.status === 'blocked' || modelResult.status === 'skipped') return modelResult

  const model = await findModel(context.consoleClient, config)
  if (!model || model.status !== activeModelStatus)
    return blocked(title, `${config.provider}/${config.name} is not active after model setup.`)

  const resource = {
    id: `${model.provider}/${model.name}`,
    kind: 'model',
    name: title,
  }
  const defaultModelResponse = await context.consoleClient.workspaces.current.defaultModel.get({
    query: { model_type: config.type },
  })
  const defaultModel = defaultModelResponse.data
  const isExpectedDefault =
    defaultModel?.model === model.name &&
    matchesProvider(defaultModel.provider.provider, model.provider)

  if (isExpectedDefault)
    return modelResult.status === 'updated' ? modelResult : verified(title, resource)

  if (context.dryRun)
    return skipped(
      title,
      `Would set ${model.provider}/${model.name} as the workspace default Speech-to-Text model.`,
    )

  await context.consoleClient.workspaces.current.defaultModel.post({
    body: {
      model_settings: [
        {
          model: model.name,
          model_type: config.type,
          provider: model.provider,
        },
      ],
    },
  })

  const updatedDefaultModelResponse =
    await context.consoleClient.workspaces.current.defaultModel.get({
      query: { model_type: config.type },
    })
  const updatedDefaultModel = updatedDefaultModelResponse.data
  if (
    updatedDefaultModel?.model !== model.name ||
    !matchesProvider(updatedDefaultModel.provider.provider, model.provider)
  ) {
    return blocked(
      title,
      `${model.provider}/${model.name} was not selected as the workspace default Speech-to-Text model.`,
    )
  }

  return updated(title, resource)
}

const findBuiltinTool = async (client: SeedContext['consoleClient'], displayName: string) => {
  const parsed = splitToolDisplayName(displayName)
  if (!parsed.ok) return { ok: false as const, reason: parsed.reason }

  const providers = await client.workspaces.current.tools.builtin.get()
  const provider = providers.find((item) =>
    matchesNameOrLabel(parsed.providerName, item.name, item.label),
  )
  const tool = provider?.tools?.find((item) =>
    matchesNameOrLabel(parsed.toolName, item.name, item.label),
  )

  if (!provider || !tool)
    return { ok: false as const, reason: `Built-in tool "${displayName}" was not found.` }

  return {
    ok: true as const,
    resource: {
      id: `${provider.name}/${tool.name}`,
      kind: 'tool',
      name: displayName,
      providerName: provider.name,
      toolName: tool.name,
    } satisfies ToolResource,
  }
}

const seedTool = (displayName: string): SeedTask => ({
  id: `tool:${displayName}`,
  title: displayName,
  async run(context) {
    const result = await findBuiltinTool(context.consoleClient, displayName)
    if (!result.ok) return blocked(displayName, result.reason)

    return verified(displayName, result.resource)
  },
})

const findDataset = async (client: SeedContext['consoleClient'], name: string) => {
  const body = await client.datasets.get({ query: { keyword: name, limit: 20, page: 1 } })
  const dataset = body.data.find((dataset) => dataset.name === name)
  return dataset ? { id: dataset.id, name: dataset.name } : undefined
}

const requiredKnowledgeSegmentTokens = [
  agentBuilderFixedInputs.customKnowledgeQuery,
  agentBuilderFixedInputs.knowledgeRuntimeQuery,
  agentBuilderExpectedTokens.knowledgeReply,
]

const datasetHasKnowledgeSegment = async (
  client: SeedContext['consoleClient'],
  datasetId: string,
) => {
  const documents = await client.datasets.byDatasetId.documents.get({
    params: { dataset_id: datasetId },
    query: { limit: '100', page: '1' },
  })
  for (const document of documents.data) {
    const body = await client.datasets.byDatasetId.documents.byDocumentId.segments.get({
      params: { dataset_id: datasetId, document_id: document.id },
      query: {
        enabled: 'true',
        keyword: agentBuilderExpectedTokens.knowledgeReply,
        limit: 20,
        page: 1,
      },
    })
    if (
      body.data.some(
        (segment) =>
          segment.enabled &&
          requiredKnowledgeSegmentTokens.every((token) => segment.content.includes(token)),
      )
    ) {
      return true
    }
  }

  return false
}

const waitForDatasetCompleted = async (client: SeedContext['consoleClient'], datasetId: string) => {
  const deadline = Date.now() + 180_000
  let status = 'missing'

  while (Date.now() < deadline) {
    const body = await client.datasets.byDatasetId.indexingStatus.get({
      params: { dataset_id: datasetId },
    })
    status =
      body.data.length < 1
        ? 'missing'
        : body.data.every((item) => item.indexing_status === 'completed')
          ? 'completed'
          : body.data.map((item) => item.indexing_status ?? 'missing').join(',')

    if (status === 'completed') return { ok: true as const }

    await sleep(1_000)
  }

  return { ok: false as const, status }
}

const addKnowledgeDocument = async (client: SeedContext['consoleClient'], datasetId: string) => {
  const fileName = agentBuilderTestMaterials.knowledgeSource
  const uploadedFile = await client.files.upload.post({
    body: {
      file: new File(
        [Uint8Array.from(await readFile(getAgentBuilderTestMaterialPath('knowledgeSource')))],
        fileName,
        { type: 'text/plain' },
      ),
    },
  })
  const body = {
    data_source: {
      info_list: {
        data_source_type: 'upload_file',
        file_info_list: {
          file_ids: [uploadedFile.id],
        },
      },
    },
    doc_form: 'text_model',
    doc_language: 'English',
    indexing_technique: 'economy',
    process_rule: {
      mode: 'automatic',
    },
    retrieval_model: {
      reranking_enable: false,
      score_threshold_enabled: false,
      search_method: 'keyword_search',
      top_k: 4,
    },
  } satisfies KnowledgeConfig

  await client.datasets.byDatasetId.documents.post({
    body,
    params: { dataset_id: datasetId },
  })
}

const seedReadyKnowledge = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.agentKnowledgeBase
  let dataset = await findDataset(context.consoleClient, title)

  if (context.dryRun) {
    return dataset
      ? verified(title, { id: dataset.id, kind: 'dataset', name: title })
      : skipped(title, `Would create dataset "${title}".`)
  }

  const wasCreated = !dataset
  if (!dataset) {
    const createdDataset = await context.consoleClient.datasets.post({
      body: {
        indexing_technique: 'economy',
        name: title,
        permission: 'only_me',
        provider: 'vendor',
      },
    })
    dataset = { id: createdDataset.id, name: createdDataset.name }
  }

  const hasKnowledgeSegment = await datasetHasKnowledgeSegment(context.consoleClient, dataset.id)
  if (!hasKnowledgeSegment) await addKnowledgeDocument(context.consoleClient, dataset.id)

  const indexing = await waitForDatasetCompleted(context.consoleClient, dataset.id)
  if (!indexing.ok) {
    return blocked(
      title,
      `Dataset "${title}" indexing did not complete in seed timeout; last status: ${indexing.status}.`,
    )
  }

  return datasetHasKnowledgeSegment(context.consoleClient, dataset.id).then((ready) => {
    if (!ready) {
      return blocked(
        title,
        `Dataset "${title}" does not expose an indexed segment containing ${requiredKnowledgeSegmentTokens.join(' and ')} after indexing.`,
      )
    }

    const resource = { id: dataset.id, kind: 'dataset', name: title }
    return wasCreated ? created(title, resource) : verified(title, resource)
  })
}

const ensureAgent = async (client: SeedContext['consoleClient'], name: string) => {
  const body = await client.agent.get({ query: { limit: 20, name, page: 1 } })
  const existing = body.data.find((agent) => agent.name === name)

  if (existing) return { agent: existing, created: false }

  const agent = await createTestAgent(client, {
    description: 'Created by Dify E2E seed.',
    name,
    role: 'E2E seeded assistant',
  })

  return { agent, created: true }
}

const getStableModelResource = (context: SeedContext): StableModel | undefined => {
  const resource = context.resources.get('stable-model')
  if (!resource?.id) return undefined

  const separatorIndex = resource.id.lastIndexOf('/')
  if (separatorIndex === -1) return undefined

  return {
    name: resource.id.slice(separatorIndex + 1),
    provider: resource.id.slice(0, separatorIndex),
    type: stableModelConfig().type,
  }
}

const getToolResource = (context: SeedContext, displayName: string) =>
  context.resources.get(`tool:${displayName}`) as ToolResource | undefined

const toolConfig = (tool: ToolResource) =>
  ({
    credential_type: 'unauthorized',
    enabled: true,
    provider_id: tool.providerName,
    provider_type: 'builtin',
    runtime_parameters: {},
    tool_name: tool.toolName,
  }) satisfies AgentSoulDifyToolConfig

const saveSeededAgentComposer = async (
  client: SeedContext['consoleClient'],
  {
    agentId,
    config,
    shouldPublish = false,
  }: {
    agentId: string
    config: AgentSoulConfig
    shouldPublish?: boolean
  },
) => {
  await saveAgentComposerDraft(client, agentId, config)
  if (shouldPublish) {
    await client.agent.byAgentId.publish.post({
      body: { version_note: 'E2E seed' },
      params: { agent_id: agentId },
    })
  }
}

const ensureDriveSkill = async (client: SeedContext['consoleClient'], agentId: string) => {
  const skills = await getAgentDriveSkills(client, agentId)
  if (skills.some((skill) => skill.name === agentBuilderPreseededResources.summarySkill)) return

  await uploadAgentDriveSkill(client, {
    agentId,
    fileName: agentBuilderTestMaterials.summarySkill,
    filePath: getAgentBuilderTestMaterialPath('summarySkill'),
  })
}

const seedFullConfigAgent = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.fullConfigAgent
  const model = getStableModelResource(context)
  const jsonTool = getToolResource(context, agentBuilderPreseededResources.jsonReplaceTool)
  const dataset = context.resources.get('ready-knowledge')
  if (!model)
    return blocked(title, `${agentBuilderPreseededResources.stableChatModel} is not ready.`)
  if (!jsonTool)
    return blocked(title, `${agentBuilderPreseededResources.jsonReplaceTool} is not ready.`)
  if (!dataset?.id)
    return blocked(title, `${agentBuilderPreseededResources.agentKnowledgeBase} is not ready.`)

  if (context.dryRun) return skipped(title, `Would create or update Agent "${title}".`)

  const { agent, created: wasCreated } = await ensureAgent(context.consoleClient, title)
  const agentId = agent.id
  const smallFile = await uploadAgentConfigFileToDraft(context.consoleClient, {
    agentId,
    fileName: agentBuilderTestMaterials.smallFile,
    filePath: getAgentBuilderTestMaterialPath('smallFile'),
  })
  const specialFile = await uploadAgentConfigFileToDraft(context.consoleClient, {
    agentId,
    fileName: agentBuilderTestMaterials.specialFilename,
    filePath: getAgentBuilderTestMaterialPath('specialFilename'),
  })
  const summarySkill = await uploadAgentConfigSkillToDraft(context.consoleClient, {
    agentId,
    fileName: agentBuilderTestMaterials.summarySkill,
    filePath: getAgentBuilderTestMaterialPath('summarySkill'),
  })
  await ensureDriveSkill(context.consoleClient, agentId)

  await saveSeededAgentComposer(context.consoleClient, {
    agentId,
    config: createAgentSoulConfigWithKnowledgeDataset(
      createAgentSoulConfigWithModel(
        {
          ...normalAgentSoulConfig,
          config_files: [smallFile, specialFile],
          config_skills: [summarySkill],
          tools: {
            dify_tools: [toolConfig(jsonTool)],
          },
        },
        model,
      ),
      {
        id: dataset.id,
        name: dataset.name,
      } satisfies AgentKnowledgeDatasetConfig,
    ),
  })

  const resource = { id: agentId, kind: 'agent', name: title }
  return wasCreated ? created(title, resource) : updated(title, resource)
}

const seedToolStatesAgent = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.toolStatesAgent
  const jsonTool = getToolResource(context, agentBuilderPreseededResources.jsonReplaceTool)
  const tavilyTool = getToolResource(context, agentBuilderPreseededResources.tavilySearchTool)
  if (!jsonTool)
    return blocked(title, `${agentBuilderPreseededResources.jsonReplaceTool} is not ready.`)
  if (!tavilyTool)
    return blocked(title, `${agentBuilderPreseededResources.tavilySearchTool} is not ready.`)
  if (context.dryRun) return skipped(title, `Would create or update Agent "${title}".`)

  const { agent, created: wasCreated } = await ensureAgent(context.consoleClient, title)
  const summarySkill = await uploadAgentConfigSkillToDraft(context.consoleClient, {
    agentId: agent.id,
    fileName: agentBuilderTestMaterials.summarySkill,
    filePath: getAgentBuilderTestMaterialPath('summarySkill'),
  })
  await ensureDriveSkill(context.consoleClient, agent.id)
  await saveSeededAgentComposer(context.consoleClient, {
    agentId: agent.id,
    config: {
      ...normalAgentSoulConfig,
      config_skills: [summarySkill],
      tools: {
        dify_tools: [toolConfig(jsonTool), toolConfig(tavilyTool)],
      },
    },
  })

  const resource = { id: agent.id, kind: 'agent', name: title }
  return wasCreated ? created(title, resource) : updated(title, resource)
}

const seedDualRetrievalAgent = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.dualRetrievalAgent
  const dataset = context.resources.get('ready-knowledge')
  if (!dataset?.id)
    return blocked(title, `${agentBuilderPreseededResources.agentKnowledgeBase} is not ready.`)
  if (context.dryRun) return skipped(title, `Would create or update Agent "${title}".`)

  const { agent, created: wasCreated } = await ensureAgent(context.consoleClient, title)
  const datasetConfig = { id: dataset.id, name: dataset.name } satisfies AgentKnowledgeDatasetConfig
  await saveSeededAgentComposer(context.consoleClient, {
    agentId: agent.id,
    config: {
      ...normalAgentSoulConfig,
      knowledge: {
        sets: [
          {
            datasets: [datasetConfig],
            id: 'e2e-dual-retrieval-agent-decide',
            name: 'Retrieval 1',
            query: { mode: 'generated_query' },
            retrieval: { mode: 'multiple', top_k: 4 },
          },
          {
            datasets: [datasetConfig],
            id: 'e2e-dual-retrieval-custom-query',
            name: 'Retrieval 2',
            query: {
              mode: 'user_query',
              value: agentBuilderFixedInputs.customKnowledgeQuery,
            },
            retrieval: { mode: 'multiple', top_k: 4 },
          },
        ],
      },
    },
  })

  const resource = { id: agent.id, kind: 'agent', name: title }
  return wasCreated ? created(title, resource) : updated(title, resource)
}

const findWorkflow = async (client: SeedContext['consoleClient'], name: string) => {
  const body = await client.apps.get({
    query: { limit: 20, mode: 'workflow', name, page: 1 },
  })
  const workflow = body.data.find((workflow) => workflow.name === name)
  return workflow ? { id: workflow.id, name: workflow.name } : undefined
}

const seedWorkflowReference = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.workflowReferenceAgent
  const workflowName = agentBuilderPreseededResources.referenceWorkflow
  const model = getStableModelResource(context)
  if (!model)
    return blocked(title, `${agentBuilderPreseededResources.stableChatModel} is not ready.`)
  if (context.dryRun)
    return skipped(title, `Would create or update Agent "${title}" and workflow "${workflowName}".`)

  const { agent, created: wasAgentCreated } = await ensureAgent(context.consoleClient, title)
  await saveSeededAgentComposer(context.consoleClient, {
    agentId: agent.id,
    config: createAgentSoulConfigWithModel(normalAgentSoulConfig, model),
    shouldPublish: true,
  })

  let workflow = await findWorkflow(context.consoleClient, workflowName)
  let wasWorkflowCreated = false
  if (!workflow) {
    const createdWorkflow = await createTestApp(context.consoleClient, workflowName, 'workflow')
    workflow = { id: createdWorkflow.id, name: createdWorkflow.name }
    wasWorkflowCreated = true
  }
  await syncAgentV2WorkflowDraft(context.consoleClient, workflow.id, agent.id)
  await context.consoleClient.apps.byAppId.workflows.publish.post({
    body: {},
    params: { app_id: workflow.id },
  })

  const resource = { id: workflow.id, kind: 'workflow', name: workflowName }
  return wasAgentCreated || wasWorkflowCreated
    ? created(`${title} / ${workflowName}`, resource)
    : updated(`${title} / ${workflowName}`, resource)
}

const agentV2BaseSeedTasks = (): SeedTask[] => [
  {
    id: 'marketplace-plugins',
    title: 'Agent V2 marketplace plugins',
    run: (context) =>
      bootstrapMarketplacePlugins(context, {
        defaultPluginIds: agentV2MarketplacePluginIds,
        pluginIdsEnv: marketplacePluginIdsEnv,
        title: 'Agent V2 marketplace plugins',
      }),
  },
  {
    id: 'stable-model',
    title: agentBuilderPreseededResources.stableChatModel,
    run: seedStableModel,
  },
  {
    id: 'agent-decision-model',
    title: agentBuilderPreseededResources.agentDecisionChatModel,
    run: seedAgentDecisionModel,
  },
  seedTool(agentBuilderPreseededResources.jsonReplaceTool),
  seedTool(agentBuilderPreseededResources.tavilySearchTool),
  {
    id: 'ready-knowledge',
    title: agentBuilderPreseededResources.agentKnowledgeBase,
    run: seedReadyKnowledge,
  },
]

const agentV2PreparedFixtureSeedTasks = (): SeedTask[] => [
  {
    id: 'full-config-agent',
    title: agentBuilderPreseededResources.fullConfigAgent,
    run: seedFullConfigAgent,
  },
  {
    id: 'tool-states-agent',
    title: agentBuilderPreseededResources.toolStatesAgent,
    run: seedToolStatesAgent,
  },
  {
    id: 'dual-retrieval-agent',
    title: agentBuilderPreseededResources.dualRetrievalAgent,
    run: seedDualRetrievalAgent,
  },
  {
    id: 'workflow-reference',
    title: `${agentBuilderPreseededResources.workflowReferenceAgent} / ${agentBuilderPreseededResources.referenceWorkflow}`,
    run: seedWorkflowReference,
  },
]

const agentV2PreparedSeedTasks = (): SeedTask[] => [
  ...agentV2BaseSeedTasks(),
  ...agentV2PreparedFixtureSeedTasks(),
]

const agentV2ExternalRuntimeSeedTasks = (): SeedTask[] => [
  ...agentV2BaseSeedTasks(),
  {
    id: 'speech-to-text-model',
    title: agentBuilderPreseededResources.speechToTextModel,
    run: seedSpeechToTextModel,
  },
]

const agentV2PostMergeSeedTasks = (): SeedTask[] => [
  ...agentV2ExternalRuntimeSeedTasks(),
  ...agentV2PreparedFixtureSeedTasks(),
]

export const createAgentV2SeedTasks = (profile: string = 'post-merge'): SeedTask[] => {
  if (profile === 'post-merge') return agentV2PostMergeSeedTasks()

  if (profile === 'prepared') return agentV2PreparedSeedTasks()

  if (profile === 'external-runtime') return agentV2ExternalRuntimeSeedTasks()

  throw new Error(`Unknown Agent V2 seed profile "${profile}".`)
}
