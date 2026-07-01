import type { DifyWorld } from '../features/support/world'
import {
  agentBuilderExpectedTokens,
  agentBuilderFixedInputs,
  agentBuilderPreseededResources,
} from './agent-builder-resources'
import { createApiContext, expectApiResponseOK } from './api'
import {
  agentBuilderFileTreeFixtureFileNames,
  agentBuilderFileTreeFixtureFiles,
  agentBuilderTestMaterials,
} from './test-materials'

const stableChatModelProviderEnv = 'E2E_STABLE_MODEL_PROVIDER'
const stableChatModelNameEnv = 'E2E_STABLE_MODEL_NAME'
const stableChatModelTypeEnv = 'E2E_STABLE_MODEL_TYPE'
const brokenChatModelProviderEnv = 'E2E_BROKEN_MODEL_PROVIDER'
const brokenChatModelNameEnv = 'E2E_BROKEN_MODEL_NAME'
const brokenChatModelTypeEnv = 'E2E_BROKEN_MODEL_TYPE'
const activeModelStatus = 'active'
const defaultStableChatModelType = 'llm'
const defaultBrokenChatModelName = agentBuilderPreseededResources.brokenModel

export type E2EResourcePrecondition
  = | {
    ok: true
    value: string
  }
  | {
    ok: false
    reason: string
  }

export const readRequiredEnvResource = (
  envName: string,
  description: string,
): E2EResourcePrecondition => {
  const value = process.env[envName]?.trim()
  if (value)
    return { ok: true, value }

  return {
    ok: false,
    reason: `${description} requires ${envName}.`,
  }
}

export function skipBlockedPrecondition(world: DifyWorld, reason: string): 'skipped' {
  const message = `Blocked precondition: ${reason}`
  console.warn(`[e2e] ${message}`)
  world.attach(message, 'text/plain')
  return 'skipped'
}

export function skipMissingEnvResource(
  world: DifyWorld,
  envName: string,
  description: string,
): 'skipped' | string {
  const resource = readRequiredEnvResource(envName, description)
  if (resource.ok)
    return resource.value

  return skipBlockedPrecondition(world, resource.reason)
}

export const requiredAgentBuilderPreseededResources = Object.values(agentBuilderPreseededResources)

export function skipMissingAgentBuilderPreseed(
  world: DifyWorld,
  resourceName: string,
  envName: string,
): 'skipped' | string {
  return skipMissingEnvResource(
    world,
    envName,
    `Preseeded Agent Builder resource "${resourceName}"`,
  )
}

type ModelTypeListResponse = {
  data: Array<{
    provider: string
    models: Array<{
      label?: {
        en_US?: string
        zh_Hans?: string
      }
      model: string
      status?: string
    }>
    status?: string
  }>
}

type NamedResource = {
  id: string
  name: string
}

type DatasetResource = NamedResource & {
  document_count: number
  total_available_documents: number
}

type NamedResourceListResponse<T extends NamedResource = NamedResource> = {
  data: T[]
}

type DocumentIndexingStatus
  = | 'cleaning'
    | 'completed'
    | 'indexing'
    | 'parsing'
    | 'splitting'
    | 'waiting'

type DatasetIndexingStatusResponse = {
  data: Array<{
    id: string
    indexing_status?: string
  }>
}

const completedDocumentIndexingStatus: DocumentIndexingStatus = 'completed'
const activeDocumentIndexingStatuses = new Set<string>([
  'cleaning',
  'indexing',
  'parsing',
  'splitting',
  'waiting',
])

type LocalizedLabel = {
  en_US?: string
  zh_Hans?: string
}

type BuiltinToolProvider = {
  label?: LocalizedLabel
  name: string
  tools: Array<{
    label?: LocalizedLabel
    name: string
  }>
}

type AgentDriveSkillListResponse = {
  items: Array<{
    name: string
    path: string
  }>
}

type AgentDriveFileListResponse = {
  items?: Array<{
    key: string
  }>
}

type AgentComposerResponse = {
  agent_soul?: Record<string, unknown>
}

type AgentApiAccessResponse = {
  api_key_count: number
  enabled: boolean
}

type AgentApiKeyListResponse = {
  data: Array<{
    id: string
  }>
}

type AgentReferencingWorkflowsResponse = {
  data: Array<{
    app_id: string
    app_name: string
    node_ids?: string[]
  }>
}

type PreseededAgentDetailResponse = {
  active_config_is_published?: boolean
  enable_site?: boolean
  site?: {
    access_token?: string | null
    app_base_url?: string | null
    code?: string | null
  } | null
}

const findConsoleResourceByName = async <T extends NamedResource = NamedResource>({
  action,
  path,
  resourceName,
}: {
  action: string
  path: string
  resourceName: string
}) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(path)
    await expectApiResponseOK(response, action)
    const body = (await response.json()) as NamedResourceListResponse<T>

    return body.data.find(item => item.name === resourceName)
  }
  finally {
    await ctx.dispose()
  }
}

const buildQuery = (params: Record<string, string>) => new URLSearchParams(params).toString()

const matchesNameOrLabel = (value: string, name: string, label?: LocalizedLabel) =>
  value === name || value === label?.en_US || value === label?.zh_Hans

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const asString = (value: unknown) => (typeof value === 'string' ? value : '')

const hasNamedOrKeyedEntry = (items: unknown[], expectedName: string) =>
  items.some((item) => {
    const record = asRecord(item)
    const values = [record.name, record.drive_key, record.reference, record.file_id, record.id].map(
      asString,
    )

    return values.some(value => value === expectedName || value.endsWith(`/${expectedName}`))
  })

const findToolEntry = (
  items: unknown[],
  {
    providerDisplayName,
    providerName,
    toolDisplayName,
    toolName,
  }: {
    providerDisplayName: string
    providerName: string
    toolDisplayName: string
    toolName: string
  },
) =>
  items.find((item) => {
    const record = asRecord(item)
    const providerValues = [record.provider_id, record.provider, record.plugin_id, record.name].map(
      asString,
    )
    const toolValues = [record.tool_name, record.name].map(asString)

    return (
      providerValues.some(value => value === providerName || value === providerDisplayName)
      && toolValues.some(value => value === toolName || value === toolDisplayName)
    )
  })

const hasToolEntry = (
  items: unknown[],
  tool: {
    providerDisplayName: string
    providerName: string
    toolDisplayName: string
    toolName: string
  },
) => Boolean(findToolEntry(items, tool))

const hasUnauthorizedToolCredentialState = (item: unknown) => {
  const record = asRecord(item)

  return asString(record.credential_type) === 'unauthorized'
}

const hasKnowledgeDataset = (
  soul: Record<string, unknown>,
  dataset: NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>,
) => {
  const knowledge = asRecord(soul.knowledge)
  const sets = asArray(knowledge.sets)

  return sets.some((set) => {
    const datasets = asArray(asRecord(set).datasets)

    return datasets.some((item) => {
      const record = asRecord(item)
      return record.id === dataset.id || record.name === dataset.name
    })
  })
}

const hasKnowledgeSet = (
  soul: Record<string, unknown>,
  dataset: NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>,
  {
    queryMode,
    queryValue,
  }: {
    queryMode: 'generated_query' | 'user_query'
    queryValue?: string
  },
) => {
  const knowledge = asRecord(soul.knowledge)
  const sets = asArray(knowledge.sets)

  return sets.some((set) => {
    const record = asRecord(set)
    const query = asRecord(record.query)
    const datasets = asArray(record.datasets)
    const hasExpectedDataset = datasets.some((item) => {
      const datasetRecord = asRecord(item)
      return datasetRecord.id === dataset.id || datasetRecord.name === dataset.name
    })

    if (!hasExpectedDataset || query.mode !== queryMode)
      return false
    if (queryValue === undefined)
      return true

    return asString(query.value).trim() === queryValue
  })
}

const getPreseededDataset = async (resourceName: string) => {
  const query = buildQuery({ keyword: resourceName, limit: '20', page: '1' })

  return findConsoleResourceByName<DatasetResource>({
    action: `Check preseeded dataset ${resourceName}`,
    path: `/console/api/datasets?${query}`,
    resourceName,
  })
}

const getDatasetIndexingStatuses = async (datasetId: string, resourceName: string) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/datasets/${datasetId}/indexing-status`)
    await expectApiResponseOK(response, `Check preseeded dataset indexing status ${resourceName}`)
    const body = (await response.json()) as DatasetIndexingStatusResponse

    return body.data
  }
  finally {
    await ctx.dispose()
  }
}

const toDatasetResource = (
  resource: NamedResource,
): NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]> => ({
  id: resource.id,
  kind: 'dataset',
  name: resource.name,
})

const splitToolDisplayName = (resourceName: string) => {
  const [providerName, toolName] = resourceName.split('/').map(item => item.trim())

  if (!providerName || !toolName) {
    return {
      ok: false as const,
      reason: `Preseeded tool "${resourceName}" must use "Provider / Tool" format.`,
    }
  }

  return {
    ok: true as const,
    providerName,
    toolName,
  }
}

export async function skipMissingPreseededAgent(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const query = buildQuery({ limit: '20', name: resourceName, page: '1' })
  const resource = await findConsoleResourceByName({
    action: `Check preseeded Agent ${resourceName}`,
    path: `/console/api/agent?${query}`,
    resourceName,
  })

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded Agent "${resourceName}" was not found.`)

  return {
    id: resource.id,
    kind: 'agent',
    name: resource.name,
  }
}

export async function skipMissingPreseededWorkflow(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const query = buildQuery({ limit: '20', mode: 'workflow', name: resourceName, page: '1' })
  const resource = await findConsoleResourceByName({
    action: `Check preseeded workflow ${resourceName}`,
    path: `/console/api/apps?${query}`,
    resourceName,
  })

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded workflow "${resourceName}" was not found.`)

  return {
    id: resource.id,
    kind: 'workflow',
    name: resource.name,
  }
}

export async function skipMissingPreseededDataset(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  return toDatasetResource(resource)
}

export async function skipMissingReadyPreseededDataset(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  if (resource.document_count < 1) {
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" has no documents.`)
  }

  if (resource.total_available_documents !== resource.document_count) {
    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" has ${resource.total_available_documents}/${resource.document_count} available documents.`,
    )
  }

  const statuses = await getDatasetIndexingStatuses(resource.id, resourceName)
  if (statuses.length < 1) {
    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" has no document indexing status.`,
    )
  }

  const incompleteStatus = statuses.find(
    item => item.indexing_status !== completedDocumentIndexingStatus,
  )
  if (incompleteStatus) {
    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" includes document ${incompleteStatus.id} with indexing status "${incompleteStatus.indexing_status ?? 'missing'}".`,
    )
  }

  return toDatasetResource(resource)
}

export async function skipMissingIndexingPreseededDataset(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  const statuses = await getDatasetIndexingStatuses(resource.id, resourceName)
  const indexingStatus = statuses.find(item =>
    activeDocumentIndexingStatuses.has(item.indexing_status ?? ''),
  )

  if (!indexingStatus) {
    const actualStatuses
      = statuses.map(item => item.indexing_status ?? 'missing').join(', ') || 'none'

    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" is not indexing or queued; document statuses: ${actualStatuses}.`,
    )
  }

  return toDatasetResource(resource)
}

export async function skipMissingPreseededTool(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const parsed = splitToolDisplayName(resourceName)
  if (!parsed.ok)
    return skipBlockedPrecondition(world, parsed.reason)

  const ctx = await createApiContext()
  try {
    const response = await ctx.get('/console/api/workspaces/current/tools/builtin')
    await expectApiResponseOK(response, `Check preseeded tool ${resourceName}`)
    const providers = (await response.json()) as BuiltinToolProvider[]
    const provider = providers.find(item =>
      matchesNameOrLabel(parsed.providerName, item.name, item.label),
    )
    const tool = provider?.tools.find(item =>
      matchesNameOrLabel(parsed.toolName, item.name, item.label),
    )

    if (!provider || !tool)
      return skipBlockedPrecondition(world, `Preseeded tool "${resourceName}" was not found.`)

    return {
      id: `${provider.name}/${tool.name}`,
      kind: 'tool',
      name: resourceName,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentDriveSkill(
  world: DifyWorld,
  agentName: string,
  skillName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/drive/skills`)
    await expectApiResponseOK(response, `Check preseeded Agent skill ${skillName}`)
    const body = (await response.json()) as AgentDriveSkillListResponse
    const skill = body.items.find(item => item.name === skillName)

    if (!skill) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" does not include drive skill "${skillName}".`,
      )
    }

    return {
      id: skill.path,
      kind: 'skill',
      name: skill.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededFullConfigAgentCoreConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const stableModel = await skipMissingAgentBuilderStableChatModel(world)
  if (stableModel === 'skipped')
    return stableModel

  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const summarySkill = await skipMissingPreseededAgentDriveSkill(
    world,
    agentName,
    agentBuilderPreseededResources.summarySkill,
  )
  if (summarySkill === 'skipped')
    return summarySkill

  const jsonTool = await skipMissingPreseededTool(
    world,
    agentBuilderPreseededResources.jsonReplaceTool,
  )
  if (jsonTool === 'skipped')
    return jsonTool

  const knowledgeBase = await skipMissingReadyPreseededDataset(
    world,
    agentBuilderPreseededResources.agentKnowledgeBase,
  )
  if (knowledgeBase === 'skipped')
    return knowledgeBase

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent core configuration ${agentName}`)
    const body = (await response.json()) as AgentComposerResponse
    const soul = body.agent_soul ?? {}
    const missing: string[] = []

    const model = asRecord(soul.model)
    if (model.model_provider !== stableModel.provider || model.model !== stableModel.name)
      missing.push(`${agentBuilderPreseededResources.stableChatModel} model config`)

    const prompt = asString(asRecord(soul.prompt).system_prompt)
    if (!prompt.includes(agentBuilderExpectedTokens.agentReply))
      missing.push(`Prompt token ${agentBuilderExpectedTokens.agentReply}`)

    const files = asArray(asRecord(soul.files).files)
    for (const fileName of [
      agentBuilderTestMaterials.smallFile,
      agentBuilderTestMaterials.specialFilename,
    ]) {
      if (!hasNamedOrKeyedEntry(files, fileName))
        missing.push(`file ${fileName}`)
    }

    const [providerName = '', toolName = ''] = jsonTool.id.split('/')
    const parsedTool = splitToolDisplayName(agentBuilderPreseededResources.jsonReplaceTool)
    if (
      parsedTool.ok
      && !hasToolEntry(asArray(asRecord(soul.tools).dify_tools), {
        providerDisplayName: parsedTool.providerName,
        providerName,
        toolDisplayName: parsedTool.toolName,
        toolName,
      })
    ) {
      missing.push(agentBuilderPreseededResources.jsonReplaceTool)
    }

    if (!hasKnowledgeDataset(soul, knowledgeBase))
      missing.push(agentBuilderPreseededResources.agentKnowledgeBase)

    if (missing.length > 0) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing core fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededToolStatesAgentConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const summarySkill = await skipMissingPreseededAgentDriveSkill(
    world,
    agentName,
    agentBuilderPreseededResources.summarySkill,
  )
  if (summarySkill === 'skipped')
    return summarySkill

  const jsonTool = await skipMissingPreseededTool(
    world,
    agentBuilderPreseededResources.jsonReplaceTool,
  )
  if (jsonTool === 'skipped')
    return jsonTool

  const tavilyTool = await skipMissingPreseededTool(
    world,
    agentBuilderPreseededResources.tavilySearchTool,
  )
  if (tavilyTool === 'skipped')
    return tavilyTool

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent tool states ${agentName}`)
    const body = (await response.json()) as AgentComposerResponse
    const soul = body.agent_soul ?? {}
    const toolItems = asArray(asRecord(soul.tools).dify_tools)
    const missing: string[] = []

    const [jsonProviderName = '', jsonToolName = ''] = jsonTool.id.split('/')
    const parsedJsonTool = splitToolDisplayName(agentBuilderPreseededResources.jsonReplaceTool)
    if (
      parsedJsonTool.ok
      && !findToolEntry(toolItems, {
        providerDisplayName: parsedJsonTool.providerName,
        providerName: jsonProviderName,
        toolDisplayName: parsedJsonTool.toolName,
        toolName: jsonToolName,
      })
    ) {
      missing.push(agentBuilderPreseededResources.jsonReplaceTool)
    }

    const [tavilyProviderName = '', tavilyToolName = ''] = tavilyTool.id.split('/')
    const parsedTavilyTool = splitToolDisplayName(agentBuilderPreseededResources.tavilySearchTool)
    const tavilyEntry = parsedTavilyTool.ok
      ? findToolEntry(toolItems, {
          providerDisplayName: parsedTavilyTool.providerName,
          providerName: tavilyProviderName,
          toolDisplayName: parsedTavilyTool.toolName,
          toolName: tavilyToolName,
        })
      : undefined

    if (!tavilyEntry) {
      missing.push(agentBuilderPreseededResources.tavilySearchTool)
    }
    else if (!hasUnauthorizedToolCredentialState(tavilyEntry)) {
      missing.push(`${agentBuilderPreseededResources.tavilySearchTool} unauthorized credential state`)
    }

    if (missing.length > 0) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing tool state fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededDualRetrievalAgentConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const knowledgeBase = await skipMissingReadyPreseededDataset(
    world,
    agentBuilderPreseededResources.agentKnowledgeBase,
  )
  if (knowledgeBase === 'skipped')
    return knowledgeBase

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent dual retrieval ${agentName}`)
    const body = (await response.json()) as AgentComposerResponse
    const soul = body.agent_soul ?? {}
    const missing: string[] = []

    if (!hasKnowledgeSet(soul, knowledgeBase, { queryMode: 'generated_query' }))
      missing.push('Agent decide Knowledge Retrieval')

    if (
      !hasKnowledgeSet(soul, knowledgeBase, {
        queryMode: 'user_query',
        queryValue: agentBuilderFixedInputs.customKnowledgeQuery,
      })
    ) {
      missing.push('Custom query Knowledge Retrieval')
    }

    if (missing.length > 0) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing dual retrieval fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentFileTreeFixture(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const query = buildQuery({ prefix: 'files/' })
    const response = await ctx.get(`/console/api/agent/${agent.id}/drive/files?${query}`)
    await expectApiResponseOK(response, `Check preseeded Agent file tree ${agentName}`)
    const body = (await response.json()) as AgentDriveFileListResponse
    const keys = (body.items ?? []).map(item => item.key)
    const missingFiles = agentBuilderFileTreeFixtureFiles.filter(
      filePath =>
        !keys.some(key => key === `files/${filePath}` || key.endsWith(`/${filePath}`)),
    )

    if (missingFiles.length > 0) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing file tree fixture files: ${missingFiles.join(', ')}.`,
      )
    }

    return {
      id: agent.id,
      kind: 'agent',
      name: agent.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentFlatFileFixtureConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent flat file fixture ${agentName}`)
    const body = (await response.json()) as AgentComposerResponse
    const configFiles = Array.isArray(body.agent_soul?.config_files)
      ? body.agent_soul.config_files
      : []
    const fileNames = configFiles
      .map(file => (typeof file === 'object' && file !== null && 'name' in file ? file.name : undefined))
      .filter((name): name is string => typeof name === 'string')
    const missingFiles = agentBuilderFileTreeFixtureFileNames.filter(fileName => !fileNames.includes(fileName))

    if (missingFiles.length > 0) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing current flat Files fixture configuration: ${missingFiles.join(', ')}. Hierarchical Files display remains blocked until Agent config files support tree paths.`,
      )
    }

    return {
      id: agent.id,
      kind: 'agent',
      name: agent.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentBackendApiKey(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const accessResponse = await ctx.get(`/console/api/agent/${agent.id}/api-access`)
    await expectApiResponseOK(accessResponse, `Check preseeded Agent API access ${agentName}`)
    const access = (await accessResponse.json()) as AgentApiAccessResponse
    if (!access.enabled || access.api_key_count < 1) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" does not have Backend service API enabled with an API key.`,
      )
    }

    const keyResponse = await ctx.get(`/console/api/agent/${agent.id}/api-keys`)
    await expectApiResponseOK(keyResponse, `Check preseeded Agent API key ${agentName}`)
    const keys = (await keyResponse.json()) as AgentApiKeyListResponse
    const key = keys.data.at(0)
    if (!key) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" Backend service API key list is empty.`,
      )
    }

    return {
      id: key.id,
      kind: 'api-key',
      name: `${agentName} Backend service API key`,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentPublishedWebApp(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}`)
    await expectApiResponseOK(response, `Check preseeded Agent published Web app ${agentName}`)
    const detail = (await response.json()) as PreseededAgentDetailResponse
    if (detail.active_config_is_published !== true) {
      return skipBlockedPrecondition(world, `Preseeded Agent "${agentName}" is not published.`)
    }

    if (detail.enable_site !== true) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" Web app is not enabled.`,
      )
    }

    const siteToken = detail.site?.access_token ?? detail.site?.code
    if (!siteToken || !detail.site?.app_base_url) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" Web app URL is not available.`,
      )
    }

    return {
      id: agent.id,
      kind: 'agent',
      name: agent.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentWorkflowReference(
  world: DifyWorld,
  agentName: string,
  workflowName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['preseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const workflow = await skipMissingPreseededWorkflow(world, workflowName)
  if (workflow === 'skipped')
    return workflow

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/referencing-workflows`)
    await expectApiResponseOK(response, `Check preseeded Agent workflow reference ${agentName}`)
    const references = (await response.json()) as AgentReferencingWorkflowsResponse
    const reference = references.data.find(
      item => item.app_id === workflow.id || item.app_name === workflow.name,
    )

    if (!reference) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is not referenced by workflow "${workflowName}".`,
      )
    }

    if (!reference.node_ids || reference.node_ids.length < 1) {
      return skipBlockedPrecondition(
        world,
        `Preseeded workflow "${workflowName}" does not expose Agent reference nodes for "${agentName}".`,
      )
    }

    return {
      id: workflow.id,
      kind: 'workflow',
      name: workflow.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}

type ModelPreflightConfig
  = | {
    ok: true
    provider: string
    resourceName: string
    type: string
    value: string
  }
  | {
    ok: false
    reason: string
  }

export function readAgentBuilderStableChatModelConfig(): ModelPreflightConfig {
  const provider = process.env[stableChatModelProviderEnv]?.trim()
  const name = process.env[stableChatModelNameEnv]?.trim()
  const type = process.env[stableChatModelTypeEnv]?.trim() || defaultStableChatModelType

  const missing: string[] = []
  if (!provider)
    missing.push(stableChatModelProviderEnv)
  if (!name)
    missing.push(stableChatModelNameEnv)

  if (!provider || !name) {
    return {
      ok: false,
      reason: `${agentBuilderPreseededResources.stableChatModel} requires ${missing.join(', ')}.`,
    }
  }

  return {
    ok: true,
    provider,
    resourceName: agentBuilderPreseededResources.stableChatModel,
    type,
    value: name,
  }
}

export function readAgentBuilderBrokenChatModelConfig(): ModelPreflightConfig {
  const provider = process.env[brokenChatModelProviderEnv]?.trim()
  const name = process.env[brokenChatModelNameEnv]?.trim() || defaultBrokenChatModelName
  const type = process.env[brokenChatModelTypeEnv]?.trim() || defaultStableChatModelType

  if (!provider) {
    return {
      ok: false,
      reason: `${agentBuilderPreseededResources.brokenModelProvider} requires ${brokenChatModelProviderEnv}.`,
    }
  }

  return {
    ok: true,
    provider,
    resourceName: agentBuilderPreseededResources.brokenModelProvider,
    type,
    value: name,
  }
}

async function skipMissingAgentBuilderModel(
  world: DifyWorld,
  config: ModelPreflightConfig,
  {
    requireActive,
  }: {
    requireActive: boolean
  },
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['stableModel']>> {
  if (!config.ok)
    return skipBlockedPrecondition(world, config.reason)

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(
      `/console/api/workspaces/current/models/model-types/${config.type}`,
    )
    await expectApiResponseOK(response, `Check ${config.resourceName}`)
    const body = (await response.json()) as ModelTypeListResponse
    const provider = body.data.find(item => item.provider === config.provider)
    const model = provider?.models.find(
      item =>
        item.model === config.value
        || item.label?.en_US === config.value
        || item.label?.zh_Hans === config.value,
    )

    if (!provider || !model) {
      return skipBlockedPrecondition(
        world,
        `${config.resourceName} was not found as ${config.provider}/${config.value} (${config.type}).`,
      )
    }

    if (requireActive && model.status !== activeModelStatus) {
      return skipBlockedPrecondition(
        world,
        `${config.resourceName} is ${model.status ?? 'missing status'} instead of ${activeModelStatus}.`,
      )
    }

    return {
      name: model.model,
      provider: provider.provider,
      type: config.type,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingAgentBuilderStableChatModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['stableModel']>> {
  return skipMissingAgentBuilderModel(world, readAgentBuilderStableChatModelConfig(), {
    requireActive: true,
  })
}

export async function skipMissingAgentBuilderBrokenChatModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['stableModel']>> {
  return skipMissingAgentBuilderModel(world, readAgentBuilderBrokenChatModelConfig(), {
    requireActive: false,
  })
}
