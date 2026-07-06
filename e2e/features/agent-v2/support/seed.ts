import type { AgentKnowledgeDatasetConfig, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type {
  ConsoleSegmentListResponse,
  DatasetListItemResponse,
  DocumentStatusListResponse,
  DocumentWithSegmentsListResponse,
  KnowledgeConfig,
} from '@dify/contracts/api/console/datasets/types.gen'
import type {
  ModelProviderListResponse,
  ProviderWithModelsDataResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { SeedContext, SeedResource, SeedTask } from '../../../support/seed'
import type { UploadedConsoleFile } from './agent-drive'
import { readFile } from 'node:fs/promises'
import {
  createApiContext,
  createTestApp,
  expectApiResponseOK,
  publishWorkflowApp,
  syncAgentV2WorkflowDraft,
} from '../../../support/api'
import { bootstrapMarketplacePlugins } from '../../../support/marketplace-plugins'
import { sleep } from '../../../support/process'
import {
  blocked,
  created,
  skipped,
  updated,
  verified,
} from '../../../support/seed'
import {
  createAgentApiKey,
  setAgentApiAccess,
  setAgentSiteAccessAndGetURL,
} from './access-point'
import {
  createTestAgent,
  publishAgent,
  saveAgentComposerDraft,
} from './agent'
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
import {
  buildQuery,
  findConsoleResourceByName,
  isRecord,
  matchesNameOrLabel,
} from './preflight/common'
import { splitToolDisplayName } from './preflight/tools'
import {
  agentBuilderTestMaterials,
  getAgentBuilderTestMaterialPath,
} from './test-materials'

type StableModel = {
  name: string
  provider: string
  type: string
}

type ToolResource = SeedResource & {
  providerName: string
  toolName: string
}

const modelCredentialEnv = 'E2E_MODEL_PROVIDER_CREDENTIALS_JSON'
const marketplacePluginIdsEnv = 'E2E_MARKETPLACE_PLUGIN_IDS'
const marketplacePluginUniqueIdentifiersEnv = 'E2E_MARKETPLACE_PLUGIN_UNIQUE_IDENTIFIERS'
const oauthToolCredentialIdEnv = 'E2E_OAUTH_TOOL_CREDENTIAL_ID'
const oauthToolProviderEnv = 'E2E_OAUTH_TOOL_PROVIDER'
const oauthToolNameEnv = 'E2E_OAUTH_TOOL_NAME'
const activeModelStatus = 'active'
const stableModelCredentialName = 'E2E Stable Model'
const agentV2MarketplacePluginIds = [
  'langgenius/openai',
  'langgenius/json_process',
  'langgenius/tavily',
]

const getProviderAlias = (provider: string) => provider.split('/').filter(Boolean).at(-1) ?? provider

const matchesProvider = (actual: string, expected: string) =>
  actual === expected || getProviderAlias(actual) === getProviderAlias(expected)

const matchesProviderLabel = (provider: { label?: { en_US?: string | null, zh_Hans?: string | null } | null, provider: string }, expected: string) =>
  matchesProvider(provider.provider, expected)
  || provider.label?.en_US === expected
  || provider.label?.zh_Hans === expected

const stableModelConfig = (): StableModel => ({
  name: process.env.E2E_STABLE_MODEL_NAME?.trim() || 'gpt-5-nano',
  provider: process.env.E2E_STABLE_MODEL_PROVIDER?.trim() || 'openai',
  type: process.env.E2E_STABLE_MODEL_TYPE?.trim() || 'llm',
})

const agentDecisionModelConfig = (): StableModel => ({
  name: process.env.E2E_AGENT_DECISION_MODEL_NAME?.trim() || 'gpt-5.5',
  provider: process.env.E2E_AGENT_DECISION_MODEL_PROVIDER?.trim() || 'openai',
  type: process.env.E2E_AGENT_DECISION_MODEL_TYPE?.trim() || 'llm',
})

const parseJsonEnv = (envName: string) => {
  const raw = process.env[envName]?.trim()
  if (!raw)
    return { ok: false as const, reason: `${envName} is required.` }

  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value))
      return { ok: false as const, reason: `${envName} must be a JSON object.` }

    return { ok: true as const, value }
  }
  catch (error) {
    return {
      ok: false as const,
      reason: `${envName} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

const findChatModel = async (config: StableModel, title: string) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/workspaces/current/models/model-types/${config.type}`)
    await expectApiResponseOK(response, `Check ${title}`)
    const body = (await response.json()) as ProviderWithModelsDataResponse
    const provider = body.data.find(item => matchesProvider(item.provider, config.provider))
    const model = provider?.models.find(
      item =>
        item.model === config.name
        || item.label?.en_US === config.name
        || item.label?.zh_Hans === config.name,
    )

    if (!provider || !model)
      return undefined

    return {
      name: model.model,
      provider: provider.provider,
      status: model.status,
      type: config.type,
    }
  }
  finally {
    await ctx.dispose()
  }
}

const resolveProvider = async (config: StableModel) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/workspaces/current/model-providers?${buildQuery({ model_type: config.type })}`)
    await expectApiResponseOK(response, `Resolve model provider ${config.provider}`)
    const body = (await response.json()) as ModelProviderListResponse
    const provider = body.data.find(item => matchesProviderLabel(item, config.provider))

    return {
      availableProviders: body.data.map(provider => provider.provider),
      credential: provider?.custom_configuration.available_credentials?.find(
        credential => credential.credential_name === stableModelCredentialName,
      ),
      provider: provider?.provider,
    }
  }
  finally {
    await ctx.dispose()
  }
}

const selectCustomProviderCredential = async (provider: string, credentialId?: string) => {
  const ctx = await createApiContext()
  try {
    if (credentialId) {
      const switchResponse = await ctx.post(
        `/console/api/workspaces/current/model-providers/${provider}/credentials/switch`,
        {
          data: { credential_id: credentialId },
        },
      )
      await expectApiResponseOK(switchResponse, `Switch model provider credential for ${provider}`)
    }

    const preferredResponse = await ctx.post(
      `/console/api/workspaces/current/model-providers/${provider}/preferred-provider-type`,
      {
        data: { preferred_provider_type: 'custom' },
      },
    )
    await expectApiResponseOK(preferredResponse, `Select custom provider credential for ${provider}`)
  }
  finally {
    await ctx.dispose()
  }
}

const upsertStableProviderCredential = async (
  provider: string,
  credentials: Record<string, unknown>,
  credentialId?: string,
) => {
  const ctx = await createApiContext()
  try {
    if (credentialId) {
      const updateResponse = await ctx.put(
        `/console/api/workspaces/current/model-providers/${provider}/credentials`,
        {
          data: {
            credential_id: credentialId,
            credentials,
            name: stableModelCredentialName,
          },
        },
      )
      await expectApiResponseOK(updateResponse, `Update model provider credential for ${provider}`)
      return
    }

    const createResponse = await ctx.post(
      `/console/api/workspaces/current/model-providers/${provider}/credentials`,
      {
        data: {
          credentials,
          name: stableModelCredentialName,
        },
      },
    )
    await expectApiResponseOK(createResponse, `Create model provider credential for ${provider}`)
  }
  finally {
    await ctx.dispose()
  }
}

const seedChatModel = async (context: SeedContext, {
  config,
  title,
}: {
  config: StableModel
  title: string
}) => {
  const existing = await findChatModel(config, title)
  const resource = {
    id: `${existing?.provider ?? config.provider}/${existing?.name ?? config.name}`,
    kind: 'model',
    name: title,
  }

  if (existing?.status === activeModelStatus)
    return verified(title, resource)

  if (context.dryRun)
    return skipped(title, `Would configure ${config.provider}/${config.name} using ${modelCredentialEnv}.`)

  const credentials = parseJsonEnv(modelCredentialEnv)
  if (!credentials.ok)
    return blocked(title, `${config.provider}/${config.name} is not active; ${credentials.reason}`)

  const { availableProviders, credential, provider } = await resolveProvider(config)
  if (!provider) {
    const available = availableProviders.length > 0
      ? availableProviders.join(', ')
      : 'none'
    return blocked(
      title,
      `Provider ${config.provider} was not found in available model providers for ${config.type}. Available providers: ${available}.`,
    )
  }

  try {
    await upsertStableProviderCredential(provider, credentials.value, credential?.credential_id)
    await selectCustomProviderCredential(provider, credential?.credential_id)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(`Credential with name '${stableModelCredentialName}' already exists.`))
      return blocked(title, message)

    const refreshed = await resolveProvider(config)
    if (!refreshed.provider || !refreshed.credential) {
      return blocked(
        title,
        `Credential ${stableModelCredentialName} already exists for ${provider}, but the seed could not resolve its credential id.`,
      )
    }

    try {
      await upsertStableProviderCredential(
        refreshed.provider,
        credentials.value,
        refreshed.credential.credential_id,
      )
      await selectCustomProviderCredential(refreshed.provider, refreshed.credential.credential_id)
    }
    catch (retryError) {
      return blocked(title, retryError instanceof Error ? retryError.message : String(retryError))
    }
  }

  const seeded = await findChatModel(config, title)
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

const seedStableModel = async (context: SeedContext) => seedChatModel(context, {
  config: stableModelConfig(),
  title: agentBuilderPreseededResources.stableChatModel,
})

const seedAgentDecisionModel = async (context: SeedContext) => seedChatModel(context, {
  config: agentDecisionModelConfig(),
  title: agentBuilderPreseededResources.agentDecisionChatModel,
})

type BuiltinToolProvider = {
  label?: { en_US?: string, zh_Hans?: string }
  name: string
  tools: Array<{
    label?: { en_US?: string, zh_Hans?: string }
    name: string
  }>
}

const findBuiltinTool = async (displayName: string) => {
  const parsed = splitToolDisplayName(displayName)
  if (!parsed.ok)
    return { ok: false as const, reason: parsed.reason }

  const ctx = await createApiContext()
  try {
    const response = await ctx.get('/console/api/workspaces/current/tools/builtin')
    await expectApiResponseOK(response, `Check built-in tool ${displayName}`)
    const providers = (await response.json()) as BuiltinToolProvider[]
    const provider = providers.find(item =>
      matchesNameOrLabel(parsed.providerName, item.name, item.label))
    const tool = provider?.tools.find(item =>
      matchesNameOrLabel(parsed.toolName, item.name, item.label))

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
  finally {
    await ctx.dispose()
  }
}

const seedTool = (displayName: string): SeedTask => ({
  id: `tool:${displayName}`,
  title: displayName,
  async run() {
    const result = await findBuiltinTool(displayName)
    if (!result.ok)
      return blocked(displayName, result.reason)

    return verified(displayName, result.resource)
  },
})

const uploadConsoleFile = async (fileName: string, filePath: string): Promise<UploadedConsoleFile> => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/files/upload', {
      multipart: {
        file: {
          buffer: await readFile(filePath),
          mimeType: 'text/plain',
          name: fileName,
        },
      },
    })
    await expectApiResponseOK(response, `Upload seed file ${fileName}`)
    return (await response.json()) as UploadedConsoleFile
  }
  finally {
    await ctx.dispose()
  }
}

const findDataset = (name: string) => {
  const query = buildQuery({ keyword: name, limit: '20', page: '1' })
  return findConsoleResourceByName<DatasetListItemResponse>({
    action: `Find seed dataset ${name}`,
    path: `/console/api/datasets?${query}`,
    resourceName: name,
  })
}

const getDatasetDocuments = async (datasetId: string) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/datasets/${datasetId}/documents?${buildQuery({ limit: '100', page: '1' })}`)
    await expectApiResponseOK(response, `List dataset documents ${datasetId}`)
    const body = (await response.json()) as DocumentWithSegmentsListResponse
    return body.data
  }
  finally {
    await ctx.dispose()
  }
}

const requiredKnowledgeSegmentTokens = [
  agentBuilderFixedInputs.customKnowledgeQuery,
  agentBuilderFixedInputs.knowledgeRuntimeQuery,
  agentBuilderExpectedTokens.knowledgeReply,
]

const datasetHasKnowledgeSegment = async (datasetId: string) => {
  const documents = await getDatasetDocuments(datasetId)
  const ctx = await createApiContext()
  try {
    for (const document of documents) {
      const response = await ctx.get(
        `/console/api/datasets/${datasetId}/documents/${document.id}/segments?${buildQuery({
          enabled: 'true',
          keyword: agentBuilderExpectedTokens.knowledgeReply,
          limit: '20',
          page: '1',
        })}`,
      )
      await expectApiResponseOK(response, `Check dataset knowledge segment ${agentBuilderExpectedTokens.knowledgeReply}`)
      const body = (await response.json()) as ConsoleSegmentListResponse
      if (body.data.some(segment =>
        segment.enabled
        && requiredKnowledgeSegmentTokens.every(token => segment.content.includes(token)),
      )) {
        return true
      }
    }

    return false
  }
  finally {
    await ctx.dispose()
  }
}

const waitForDatasetCompleted = async (datasetId: string) => {
  const deadline = Date.now() + 180_000
  let status = 'missing'

  while (Date.now() < deadline) {
    const ctx = await createApiContext()
    try {
      const response = await ctx.get(`/console/api/datasets/${datasetId}/indexing-status`)
      await expectApiResponseOK(response, `Check dataset indexing ${datasetId}`)
      const body = (await response.json()) as DocumentStatusListResponse
      status = body.data.length < 1
        ? 'missing'
        : body.data.every(item => item.indexing_status === 'completed')
          ? 'completed'
          : body.data.map(item => item.indexing_status ?? 'missing').join(',')

      if (status === 'completed')
        return { ok: true as const }
    }
    finally {
      await ctx.dispose()
    }

    await sleep(1_000)
  }

  return { ok: false as const, status }
}

const addKnowledgeDocument = async (datasetId: string) => {
  const uploadedFile = await uploadConsoleFile(
    agentBuilderTestMaterials.knowledgeSource,
    getAgentBuilderTestMaterialPath('knowledgeSource'),
  )
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

  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/datasets/${datasetId}/documents`, { data: body })
    await expectApiResponseOK(response, `Seed knowledge document ${datasetId}`)
  }
  finally {
    await ctx.dispose()
  }
}

const createDataset = async (name: string) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/datasets', {
      data: {
        indexing_technique: 'economy',
        name,
        permission: 'only_me',
        provider: 'vendor',
      },
    })
    await expectApiResponseOK(response, `Create dataset ${name}`)
    return (await response.json()) as DatasetListItemResponse
  }
  finally {
    await ctx.dispose()
  }
}

const seedReadyKnowledge = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.agentKnowledgeBase
  let dataset = await findDataset(title)

  if (context.dryRun) {
    return dataset
      ? verified(title, { id: dataset.id, kind: 'dataset', name: title })
      : skipped(title, `Would create dataset "${title}".`)
  }

  const wasCreated = !dataset
  dataset ??= await createDataset(title)

  const hasKnowledgeSegment = await datasetHasKnowledgeSegment(dataset.id)
  if (!hasKnowledgeSegment)
    await addKnowledgeDocument(dataset.id)

  const indexing = await waitForDatasetCompleted(dataset.id)
  if (!indexing.ok) {
    return blocked(
      title,
      `Dataset "${title}" indexing did not complete in seed timeout; last status: ${indexing.status}.`,
    )
  }

  return datasetHasKnowledgeSegment(dataset.id)
    .then((ready) => {
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

const ensureAgent = async (name: string) => {
  const query = buildQuery({ limit: '20', name, page: '1' })
  const existing = await findConsoleResourceByName({
    action: `Find seed Agent ${name}`,
    path: `/console/api/agent?${query}`,
    resourceName: name,
  })

  if (existing)
    return { agent: existing, created: false }

  const agent = await createTestAgent({
    description: 'Created by Dify E2E seed.',
    name,
    role: 'E2E seeded assistant',
  })

  return { agent, created: true }
}

const getStableModelResource = (context: SeedContext): StableModel | undefined => {
  const resource = context.resources.get('stable-model')
  if (!resource?.id)
    return undefined

  const separatorIndex = resource.id.lastIndexOf('/')
  if (separatorIndex === -1)
    return undefined

  return {
    name: resource.id.slice(separatorIndex + 1),
    provider: resource.id.slice(0, separatorIndex),
    type: stableModelConfig().type,
  }
}

const getToolResource = (context: SeedContext, displayName: string) =>
  context.resources.get(`tool:${displayName}`) as ToolResource | undefined

const toolConfig = (tool: ToolResource) => ({
  credential_type: 'unauthorized' as const,
  enabled: true,
  provider_id: tool.providerName,
  provider_type: 'builtin',
  runtime_parameters: {},
  tool_name: tool.toolName,
})

const saveSeededAgentComposer = async ({
  agentId,
  config,
  shouldPublish = false,
}: {
  agentId: string
  config: AgentSoulConfig
  shouldPublish?: boolean
}) => {
  await saveAgentComposerDraft(agentId, config)
  if (shouldPublish)
    await publishAgent(agentId, 'E2E seed')
}

const ensureDriveSkill = async (agentId: string) => {
  const skills = await getAgentDriveSkills(agentId)
  if (skills.some(skill => skill.name === agentBuilderPreseededResources.summarySkill))
    return

  await uploadAgentDriveSkill({
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

  if (context.dryRun)
    return skipped(title, `Would create or update Agent "${title}".`)

  const { agent, created: wasCreated } = await ensureAgent(title)
  const agentId = agent.id
  const smallFile = await uploadAgentConfigFileToDraft({
    agentId,
    fileName: agentBuilderTestMaterials.smallFile,
    filePath: getAgentBuilderTestMaterialPath('smallFile'),
  })
  const specialFile = await uploadAgentConfigFileToDraft({
    agentId,
    fileName: agentBuilderTestMaterials.specialFilename,
    filePath: getAgentBuilderTestMaterialPath('specialFilename'),
  })
  const summarySkill = await uploadAgentConfigSkillToDraft({
    agentId,
    fileName: agentBuilderTestMaterials.summarySkill,
    filePath: getAgentBuilderTestMaterialPath('summarySkill'),
  })
  await ensureDriveSkill(agentId)

  await saveSeededAgentComposer({
    agentId,
    config: createAgentSoulConfigWithKnowledgeDataset(
      createAgentSoulConfigWithModel({
        ...normalAgentSoulConfig,
        config_files: [smallFile, specialFile],
        config_skills: [summarySkill],
        tools: {
          dify_tools: [toolConfig(jsonTool)],
        },
      }, model),
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
  if (context.dryRun)
    return skipped(title, `Would create or update Agent "${title}".`)

  const { agent, created: wasCreated } = await ensureAgent(title)
  const summarySkill = await uploadAgentConfigSkillToDraft({
    agentId: agent.id,
    fileName: agentBuilderTestMaterials.summarySkill,
    filePath: getAgentBuilderTestMaterialPath('summarySkill'),
  })
  await ensureDriveSkill(agent.id)
  await saveSeededAgentComposer({
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
  if (context.dryRun)
    return skipped(title, `Would create or update Agent "${title}".`)

  const { agent, created: wasCreated } = await ensureAgent(title)
  const datasetConfig = { id: dataset.id, name: dataset.name } satisfies AgentKnowledgeDatasetConfig
  await saveSeededAgentComposer({
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

const seedPublishedWebAppAgent = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.publishedWebAppAgent
  const model = getStableModelResource(context)
  if (!model)
    return blocked(title, `${agentBuilderPreseededResources.stableChatModel} is not ready.`)
  if (context.dryRun)
    return skipped(title, `Would create or update Agent "${title}".`)

  const { agent, created: wasCreated } = await ensureAgent(title)
  await saveSeededAgentComposer({
    agentId: agent.id,
    config: createAgentSoulConfigWithModel(normalAgentSoulConfig, model),
    shouldPublish: true,
  })
  await setAgentSiteAccessAndGetURL(agent.id, true)

  const resource = { id: agent.id, kind: 'agent', name: title }
  return wasCreated ? created(title, resource) : updated(title, resource)
}

const seedBackendApiAgent = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.backendApiEnabledAgent
  const model = getStableModelResource(context)
  if (!model)
    return blocked(title, `${agentBuilderPreseededResources.stableChatModel} is not ready.`)
  if (context.dryRun)
    return skipped(title, `Would create or update Agent "${title}".`)

  const { agent, created: wasCreated } = await ensureAgent(title)
  await saveSeededAgentComposer({
    agentId: agent.id,
    config: createAgentSoulConfigWithModel(normalAgentSoulConfig, model),
    shouldPublish: true,
  })
  const access = await setAgentApiAccess(agent.id, true)
  if (access.api_key_count < 1)
    await createAgentApiKey(agent.id)

  const resource = { id: agent.id, kind: 'agent', name: title }
  return wasCreated ? created(title, resource) : updated(title, resource)
}

const findWorkflow = (name: string) => {
  const query = buildQuery({ limit: '20', mode: 'workflow', name, page: '1' })
  return findConsoleResourceByName({
    action: `Find seed workflow ${name}`,
    path: `/console/api/apps?${query}`,
    resourceName: name,
  })
}

const seedWorkflowReference = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.workflowReferenceAgent
  const workflowName = agentBuilderPreseededResources.referenceWorkflow
  const model = getStableModelResource(context)
  if (!model)
    return blocked(title, `${agentBuilderPreseededResources.stableChatModel} is not ready.`)
  if (context.dryRun)
    return skipped(title, `Would create or update Agent "${title}" and workflow "${workflowName}".`)

  const { agent, created: wasAgentCreated } = await ensureAgent(title)
  await saveSeededAgentComposer({
    agentId: agent.id,
    config: createAgentSoulConfigWithModel(normalAgentSoulConfig, model),
    shouldPublish: true,
  })

  let workflow = await findWorkflow(workflowName)
  let wasWorkflowCreated = false
  if (!workflow) {
    workflow = await createTestApp(workflowName, 'workflow')
    wasWorkflowCreated = true
  }
  await syncAgentV2WorkflowDraft(workflow.id, agent.id)
  await publishWorkflowApp(workflow.id)

  const resource = { id: workflow.id, kind: 'workflow', name: workflowName }
  return wasAgentCreated || wasWorkflowCreated
    ? created(`${title} / ${workflowName}`, resource)
    : updated(`${title} / ${workflowName}`, resource)
}

const seedOAuthToolAgent = async (context: SeedContext) => {
  const title = agentBuilderPreseededResources.oauthToolAgent
  const credentialId = process.env[oauthToolCredentialIdEnv]?.trim()
  const providerName = process.env[oauthToolProviderEnv]?.trim()
  const toolName = process.env[oauthToolNameEnv]?.trim()
  if (!credentialId || !providerName || !toolName) {
    return blocked(
      title,
      `${oauthToolCredentialIdEnv}, ${oauthToolProviderEnv}, and ${oauthToolNameEnv} are required for OAuth2 tool seed.`,
    )
  }
  if (context.dryRun)
    return skipped(title, `Would create or update Agent "${title}" with OAuth2 tool ${providerName}/${toolName}.`)

  const { agent, created: wasCreated } = await ensureAgent(title)
  await saveSeededAgentComposer({
    agentId: agent.id,
    config: {
      ...normalAgentSoulConfig,
      tools: {
        dify_tools: [
          {
            credential_ref: {
              id: credentialId,
              provider: providerName,
              type: 'provider',
            },
            credential_type: 'oauth2',
            enabled: true,
            provider_id: providerName,
            provider_type: 'builtin',
            runtime_parameters: {},
            tool_name: toolName,
          },
        ],
      },
    },
  })

  const resource = { id: agent.id, kind: 'agent', name: title }
  return wasCreated ? created(title, resource) : updated(title, resource)
}

const agentV2BaseSeedTasks = (): SeedTask[] => [
  {
    id: 'marketplace-plugins',
    title: 'Agent V2 marketplace plugins',
    run: context => bootstrapMarketplacePlugins(context, {
      defaultPluginIds: agentV2MarketplacePluginIds,
      pluginIdsEnv: marketplacePluginIdsEnv,
      pluginUniqueIdentifiersEnv: marketplacePluginUniqueIdentifiersEnv,
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

const agentV2FullSeedTasks = (): SeedTask[] => [
  ...agentV2BaseSeedTasks(),
  {
    id: 'indexing-knowledge',
    title: agentBuilderPreseededResources.indexingKnowledgeBase,
    run: async () => blocked(
      agentBuilderPreseededResources.indexingKnowledgeBase,
      'A deterministic long-lived "currently indexing" dataset seed is not implemented yet.',
    ),
  },
  {
    id: 'broken-model',
    title: agentBuilderPreseededResources.brokenModelProvider,
    run: async () => blocked(
      agentBuilderPreseededResources.brokenModelProvider,
      'Broken model fixture is validation-only for now; provide E2E_BROKEN_MODEL_PROVIDER and keep the model entry externally.',
    ),
  },
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
    id: 'oauth-tool-agent',
    title: agentBuilderPreseededResources.oauthToolAgent,
    run: seedOAuthToolAgent,
  },
  {
    id: 'dual-retrieval-agent',
    title: agentBuilderPreseededResources.dualRetrievalAgent,
    run: seedDualRetrievalAgent,
  },
  {
    id: 'published-web-app-agent',
    title: agentBuilderPreseededResources.publishedWebAppAgent,
    run: seedPublishedWebAppAgent,
  },
  {
    id: 'backend-api-agent',
    title: agentBuilderPreseededResources.backendApiEnabledAgent,
    run: seedBackendApiAgent,
  },
  {
    id: 'workflow-reference',
    title: `${agentBuilderPreseededResources.workflowReferenceAgent} / ${agentBuilderPreseededResources.referenceWorkflow}`,
    run: seedWorkflowReference,
  },
]

export const createAgentV2SeedTasks = (profile: string = 'full'): SeedTask[] => {
  if (profile === 'full')
    return agentV2FullSeedTasks()

  if (profile === 'external-runtime')
    return agentV2BaseSeedTasks()

  throw new Error(`Unknown Agent V2 seed profile "${profile}".`)
}
