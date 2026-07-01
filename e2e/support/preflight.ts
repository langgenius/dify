import type { DifyWorld } from '../features/support/world'
import { agentBuilderPreseededResources } from './agent-builder-resources'
import { createApiContext, expectApiResponseOK } from './api'

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

type DocumentIndexingStatus = 'cleaning' | 'completed' | 'indexing' | 'parsing' | 'splitting' | 'waiting'

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

type AgentApiAccessResponse = {
  api_key_count: number
  enabled: boolean
}

type AgentApiKeyListResponse = {
  data: Array<{
    id: string
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

const getPreseededDataset = async (resourceName: string) => {
  const query = buildQuery({ keyword: resourceName, limit: '20', page: '1' })

  return findConsoleResourceByName<DatasetResource>({
    action: `Check preseeded dataset ${resourceName}`,
    path: `/console/api/datasets?${query}`,
    resourceName,
  })
}

const getDatasetIndexingStatuses = async (
  datasetId: string,
  resourceName: string,
) => {
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
): NonNullable<DifyWorld['agentBuilderPreseededResources'][string]> => ({
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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  return toDatasetResource(resource)
}

export async function skipMissingReadyPreseededDataset(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  if (resource.document_count < 1) {
    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" has no documents.`,
    )
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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  const statuses = await getDatasetIndexingStatuses(resource.id, resourceName)
  const indexingStatus = statuses.find(item =>
    activeDocumentIndexingStatuses.has(item.indexing_status ?? ''),
  )

  if (!indexingStatus) {
    const actualStatuses = statuses
      .map(item => item.indexing_status ?? 'missing')
      .join(', ') || 'none'

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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
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

export async function skipMissingPreseededAgentBackendApiKey(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderPreseededResources'][string]>> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}`)
    await expectApiResponseOK(response, `Check preseeded Agent published Web app ${agentName}`)
    const detail = (await response.json()) as PreseededAgentDetailResponse
    if (detail.active_config_is_published !== true) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is not published.`,
      )
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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderStableChatModel']>> {
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
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderStableChatModel']>> {
  return skipMissingAgentBuilderModel(world, readAgentBuilderStableChatModelConfig(), {
    requireActive: true,
  })
}

export async function skipMissingAgentBuilderBrokenChatModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderStableChatModel']>> {
  return skipMissingAgentBuilderModel(world, readAgentBuilderBrokenChatModelConfig(), {
    requireActive: false,
  })
}
