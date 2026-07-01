import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createApiContext, expectApiResponseOK, setAppSiteEnabled } from './api'
import { assertE2EResourceName, createE2EResourceName } from './naming'

export type AgentSeed = {
  active_config_is_published?: boolean
  app_id?: string
  backing_app_id?: string
  description?: string
  enable_site?: boolean
  id: string
  name: string
  role?: string
  site?: {
    access_token?: string | null
    app_base_url?: string | null
    code?: string | null
  } | null
}

export type AgentComposerConfigFile = {
  file_id?: string | null
  file_kind?: string | null
  hash?: string | null
  mime_type?: string | null
  name: string
  size?: number | null
}
export type AgentComposerEnvVariable = {
  id?: string | null
  key?: string | null
  name?: string | null
  value?: unknown
  variable?: string | null
}

export type AgentSoulConfig = Record<string, unknown> & {
  config_files?: AgentComposerConfigFile[]
  env?: {
    secret_refs?: unknown[]
    variables?: AgentComposerEnvVariable[]
  }
}
export type AgentModelSelection = {
  name: string
  provider: string
}

export type AgentComposerResponse = {
  agent_soul?: AgentSoulConfig
}

export type AgentBuildDraftResponse = {
  agent_soul: AgentSoulConfig
  draft: Record<string, unknown>
  variant: 'agent_app'
}

export type AgentApiAccess = {
  api_key_count: number
  enabled: boolean
  files_upload_endpoint: string
  service_api_base_url: string
}

export type AgentApiKey = {
  id: string
  token?: string
}

export type AgentDriveSkillUpload = {
  skill: {
    archive_key?: string | null
    description: string
    name: string
    path: string
    skill_md_key: string
  }
}

export type CreateTestAgentOptions = {
  description?: string
  name?: string
  role?: string
}

export const defaultAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: 'You are a Dify Agent E2E test assistant.',
  },
}

export const normalAgentPrompt
  = 'You are a Dify Agent E2E test assistant. Reply briefly to every user message, and always include AGENT_E2E_PASS in your response.'

export const updatedAgentPrompt
  = 'You are a Dify Agent E2E test assistant. Every response must start with E2E_AGENT_UPDATED.'

export const normalAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: normalAgentPrompt,
  },
}

export const updatedAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: updatedAgentPrompt,
  },
}

export const getAgentConfigurePath = (agentId: string) => `/roster/agent/${agentId}/configure`
export const getAgentAccessPath = (agentId: string) => `/roster/agent/${agentId}/access`

const getAgentModelPluginId = (provider: string) => {
  const [organization, pluginName] = provider.split('/').filter(Boolean)

  if (organization && pluginName)
    return `${organization}/${pluginName}`

  return provider ? `langgenius/${provider}` : ''
}

const getExistingModelConfig = (agentSoul: AgentSoulConfig) => {
  const model = agentSoul.model

  if (model && typeof model === 'object' && !Array.isArray(model))
    return model as Record<string, unknown>

  return {}
}

const crc32Table = new Uint32Array(256)
for (let i = 0; i < crc32Table.length; i++) {
  let c = i
  for (let k = 0; k < 8; k++)
    c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  crc32Table[i] = c >>> 0
}

const crc32 = (buffer: Buffer) => {
  let crc = 0xFFFFFFFF
  for (const byte of buffer)
    crc = crc32Table[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const createSingleFileZip = ({
  content,
  entryName,
}: {
  content: Buffer
  entryName: string
}) => {
  const entryNameBuffer = Buffer.from(entryName)
  const checksum = crc32(content)
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034B50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(0, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0, 12)
  localHeader.writeUInt32LE(checksum, 14)
  localHeader.writeUInt32LE(content.length, 18)
  localHeader.writeUInt32LE(content.length, 22)
  localHeader.writeUInt16LE(entryNameBuffer.length, 26)
  localHeader.writeUInt16LE(0, 28)

  const centralDirectoryOffset = localHeader.length + entryNameBuffer.length + content.length
  const centralDirectoryHeader = Buffer.alloc(46)
  centralDirectoryHeader.writeUInt32LE(0x02014B50, 0)
  centralDirectoryHeader.writeUInt16LE(20, 4)
  centralDirectoryHeader.writeUInt16LE(20, 6)
  centralDirectoryHeader.writeUInt16LE(0, 8)
  centralDirectoryHeader.writeUInt16LE(0, 10)
  centralDirectoryHeader.writeUInt16LE(0, 12)
  centralDirectoryHeader.writeUInt16LE(0, 14)
  centralDirectoryHeader.writeUInt32LE(checksum, 16)
  centralDirectoryHeader.writeUInt32LE(content.length, 20)
  centralDirectoryHeader.writeUInt32LE(content.length, 24)
  centralDirectoryHeader.writeUInt16LE(entryNameBuffer.length, 28)
  centralDirectoryHeader.writeUInt16LE(0, 30)
  centralDirectoryHeader.writeUInt16LE(0, 32)
  centralDirectoryHeader.writeUInt16LE(0, 34)
  centralDirectoryHeader.writeUInt16LE(0, 36)
  centralDirectoryHeader.writeUInt32LE(0, 38)
  centralDirectoryHeader.writeUInt32LE(0, 42)

  const centralDirectorySize = centralDirectoryHeader.length + entryNameBuffer.length
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054B50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(1, 8)
  endOfCentralDirectory.writeUInt16LE(1, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12)
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([
    localHeader,
    entryNameBuffer,
    content,
    centralDirectoryHeader,
    entryNameBuffer,
    endOfCentralDirectory,
  ])
}

const toSkillArchiveUpload = async ({
  fileName,
  filePath,
}: {
  fileName: string
  filePath: string
}) => {
  if (fileName.endsWith('.zip') || fileName.endsWith('.skill')) {
    return {
      buffer: await readFile(filePath),
      name: path.basename(fileName),
    }
  }
  const sourceDirName = path.basename(path.dirname(fileName))
  const archiveBaseName = sourceDirName && sourceDirName !== '.'
    ? sourceDirName
    : path.basename(fileName, path.extname(fileName))

  return {
    buffer: createSingleFileZip({
      content: await readFile(filePath),
      entryName: 'SKILL.md',
    }),
    name: `${archiveBaseName}.skill`,
  }
}

export function createAgentSoulConfigWithModel(
  agentSoul: AgentSoulConfig,
  model: AgentModelSelection,
): AgentSoulConfig {
  return {
    ...agentSoul,
    model: {
      ...getExistingModelConfig(agentSoul),
      plugin_id: getAgentModelPluginId(model.provider),
      model_provider: model.provider,
      model: model.name,
      model_settings: {
        temperature: 0,
        max_tokens: 512,
      },
    },
  }
}

export async function createTestAgent({
  description = 'Created by Dify E2E.',
  name = createE2EResourceName('Agent'),
  role = 'E2E test assistant',
}: CreateTestAgentOptions = {}): Promise<AgentSeed> {
  assertE2EResourceName(name, 'Agent')
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/agent', {
      data: {
        description,
        icon: '🤖',
        icon_background: '#FFEAD5',
        icon_type: 'emoji',
        name,
        role,
      },
    })
    await expectApiResponseOK(response, 'Create Agent v2 test agent')
    return (await response.json()) as AgentSeed
  }
  finally {
    await ctx.dispose()
  }
}

export async function createConfiguredTestAgent({
  agentSoul = normalAgentSoulConfig,
  seed,
}: {
  agentSoul?: AgentSoulConfig
  seed?: CreateTestAgentOptions
} = {}): Promise<AgentSeed> {
  const agent = await createTestAgent(seed)
  await saveAgentComposerDraft(agent.id, agentSoul)
  return agent
}

export async function getTestAgent(agentId: string): Promise<AgentSeed> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}`)
    await expectApiResponseOK(response, `Get Agent v2 test agent ${agentId}`)
    return (await response.json()) as AgentSeed
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteTestAgent(agentId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}`)
    await expectApiResponseOK(response, `Delete Agent v2 test agent ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function saveAgentComposerDraft(
  agentId: string,
  agentSoul: AgentSoulConfig = defaultAgentSoulConfig,
): Promise<AgentComposerResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.put(`/console/api/agent/${agentId}/composer`, {
      data: {
        agent_soul: agentSoul,
        save_strategy: 'save_to_current_version',
        variant: 'agent_app',
      },
    })
    await expectApiResponseOK(response, `Save Agent v2 composer draft for ${agentId}`)
    return (await response.json()) as AgentComposerResponse
  }
  finally {
    await ctx.dispose()
  }
}

export async function uploadAgentDriveSkill({
  agentId,
  fileName,
  filePath,
}: {
  agentId: string
  fileName: string
  filePath: string
}): Promise<AgentDriveSkillUpload> {
  const ctx = await createApiContext()
  try {
    const upload = await toSkillArchiveUpload({ fileName, filePath })
    const response = await ctx.post(`/console/api/agent/${agentId}/skills/upload`, {
      multipart: {
        file: {
          buffer: upload.buffer,
          mimeType: 'application/zip',
          name: upload.name,
        },
      },
    })
    await expectApiResponseOK(response, `Upload Agent v2 drive skill ${fileName} for ${agentId}`)
    return (await response.json()) as AgentDriveSkillUpload
  }
  finally {
    await ctx.dispose()
  }
}

export async function getAgentComposerDraft(agentId: string): Promise<AgentComposerResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/composer`)
    await expectApiResponseOK(response, `Get Agent v2 composer draft for ${agentId}`)
    return (await response.json()) as AgentComposerResponse
  }
  finally {
    await ctx.dispose()
  }
}

export async function checkoutAgentBuildDraft(agentId: string): Promise<AgentBuildDraftResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/build-draft/checkout`, {
      data: { force: true },
    })
    await expectApiResponseOK(response, `Checkout Agent v2 build draft for ${agentId}`)
    return (await response.json()) as AgentBuildDraftResponse
  }
  finally {
    await ctx.dispose()
  }
}

export async function saveAgentBuildDraft(
  agentId: string,
  agentSoul: AgentSoulConfig,
): Promise<AgentBuildDraftResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.put(`/console/api/agent/${agentId}/build-draft`, {
      data: {
        agent_soul: agentSoul,
        save_strategy: 'save_to_current_version',
        variant: 'agent_app',
      },
    })
    await expectApiResponseOK(response, `Save Agent v2 build draft for ${agentId}`)
    return (await response.json()) as AgentBuildDraftResponse
  }
  finally {
    await ctx.dispose()
  }
}

export async function discardAgentBuildDraft(agentId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}/build-draft`)
    await expectApiResponseOK(response, `Discard Agent v2 build draft for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function publishAgent(agentId: string, versionNote = 'E2E publish'): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/publish`, {
      data: { version_note: versionNote },
    })
    await expectApiResponseOK(response, `Publish Agent v2 test agent ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function enableAgentSiteAndGetURL(agentId: string): Promise<string> {
  const agent = await getTestAgent(agentId)
  const appId = agent.app_id ?? agent.backing_app_id
  if (!appId)
    throw new Error(`Agent v2 ${agentId} does not expose a backing app ID.`)

  const appDetail = await setAppSiteEnabled(appId, true)
  const token = agent.site?.access_token ?? agent.site?.code ?? appDetail.site.access_token
  const baseURL = agent.site?.app_base_url ?? appDetail.site.app_base_url

  return `${baseURL.replace(/\/$/, '')}/agent/${token}`
}

export async function getAgentApiAccess(agentId: string): Promise<AgentApiAccess> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/api-access`)
    await expectApiResponseOK(response, `Get Agent v2 API access for ${agentId}`)
    return (await response.json()) as AgentApiAccess
  }
  finally {
    await ctx.dispose()
  }
}

export async function setAgentApiAccess(
  agentId: string,
  enabled: boolean,
): Promise<AgentApiAccess> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/api-enable`, {
      data: { enable_api: enabled },
    })
    await expectApiResponseOK(
      response,
      `${enabled ? 'Enable' : 'Disable'} Agent v2 API access for ${agentId}`,
    )
    return (await response.json()) as AgentApiAccess
  }
  finally {
    await ctx.dispose()
  }
}

export async function createAgentApiKey(agentId: string): Promise<AgentApiKey> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/api-keys`)
    await expectApiResponseOK(response, `Create Agent v2 API key for ${agentId}`)
    return (await response.json()) as AgentApiKey
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteAgentApiKey(agentId: string, apiKeyId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}/api-keys/${apiKeyId}`)
    await expectApiResponseOK(response, `Delete Agent v2 API key ${apiKeyId} for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteAgentConfigFile(agentId: string, name: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}/config/files/${encodeURIComponent(name)}`)
    await expectApiResponseOK(response, `Delete Agent v2 config file ${name} for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteAgentDriveFile(agentId: string, key: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const searchParams = new URLSearchParams({ key })
    const response = await ctx.delete(`/console/api/agent/${agentId}/files?${searchParams}`)
    await expectApiResponseOK(response, `Delete Agent v2 drive file ${key} for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}
