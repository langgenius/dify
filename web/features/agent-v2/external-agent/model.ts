import type {
  ExternalAgentAssetResponse,
  ExternalAgentDetailResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { ExternalAgentListItem } from '../roster/components/external-agent-list'
import type { AppIconProps } from '@/app/components/base/app-icon'

export type ExternalAgentSkill = {
  id: string
  name: string
  description: string
  tags: string[]
  inputFormats?: string[]
  outputFormats?: string[]
  examples: string[]
}

export type ExternalAgentOverview = {
  asset: ExternalAgentAssetResponse
  agent: ExternalAgentListItem
  skills: ExternalAgentSkill[]
  inputModes: string[]
  outputModes: string[]
  defaultInputFormats: string[]
  defaultOutputFormats: string[]
  endpoint: string
  authentication: 'none' | 'bearer'
  hasCredential: boolean
  connectionRevisionId: string
  authCheck: string
  protocol: string
  verifiedAt: string | null
  connectedBy: string
  tracing: boolean
  traceabilitySupported: boolean
  provider: string
  version: string
  documentationUrl: string | null
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function formatAgentMimeType(mode: string): string {
  const mime = mode.toLowerCase().split(';')[0]?.trim()
  switch (mime) {
    case 'text/plain':
      return 'Text'
    case 'application/pdf':
      return 'PDF'
    case 'text/markdown':
      return 'Markdown'
    case 'image/png':
      return 'PNG'
    case 'image/jpeg':
      return 'JPEG'
    default:
      return mode
  }
}

export function toExternalAgentListItem(
  asset: ExternalAgentAssetResponse,
  currentAccountId?: string,
): ExternalAgentListItem {
  const type = asset.icon_type
  const icon: AppIconProps['icon'] =
    type === 'emoji' || type === 'image' || type === 'link'
      ? {
          icon_type: type,
          icon: asset.icon,
          icon_background: asset.icon_background,
          ...('icon_url' in asset && typeof asset.icon_url === 'string'
            ? { icon_url: asset.icon_url }
            : {}),
        }
      : undefined
  return {
    key: asset.id,
    name: asset.name,
    role: asset.role,
    description: asset.description,
    icon,
    enabled: asset.enabled,
    connectedByMe: asset.created_by === currentAccountId,
    createdAt: Date.parse(asset.created_at),
    updatedAt: Date.parse(asset.updated_at),
  }
}

export function toExternalAgentOverview(
  detail: ExternalAgentDetailResponse,
): ExternalAgentOverview {
  const { asset, connection } = detail
  const card = asRecord(connection.card)
  const capabilities = asRecord(connection.capabilities)
  const provider = asRecord(card.provider)
  const inputModes = stringValues(card.defaultInputModes)
  const outputModes = stringValues(card.defaultOutputModes)
  const skills = Array.isArray(card.skills) ? card.skills : []
  const interfaces = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : []
  const protocolVersion = interfaces
    .map((value) => stringValue(asRecord(value).protocolVersion))
    .find(Boolean)
  return {
    asset,
    agent: toExternalAgentListItem(asset),
    skills: skills.map((value) => {
      const skill = asRecord(value)
      return {
        id: stringValue(skill.id),
        name: stringValue(skill.name),
        description: stringValue(skill.description),
        tags: stringValues(skill.tags),
        inputFormats: Array.isArray(skill.inputModes)
          ? stringValues(skill.inputModes).map(formatAgentMimeType)
          : undefined,
        outputFormats: Array.isArray(skill.outputModes)
          ? stringValues(skill.outputModes).map(formatAgentMimeType)
          : undefined,
        examples: stringValues(skill.examples),
      }
    }),
    inputModes,
    outputModes,
    defaultInputFormats: inputModes.map(formatAgentMimeType),
    defaultOutputFormats: outputModes.map(formatAgentMimeType),
    endpoint: stringValue(connection.endpoint),
    authentication: connection.auth_type === 'bearer' ? 'bearer' : 'none',
    hasCredential: connection.has_credential === true,
    connectionRevisionId: stringValue(connection.revision_id),
    authCheck: stringValue(connection.auth_check),
    protocol: protocolVersion ? `A2A ${protocolVersion}` : stringValue(connection.profile),
    verifiedAt: typeof connection.verified_at === 'string' ? connection.verified_at : null,
    connectedBy: asset.created_by,
    tracing: asset.tracing_enabled,
    traceabilitySupported: capabilities.traceability_supported === true,
    provider: stringValue(provider.organization),
    version: stringValue(card.version),
    documentationUrl: typeof card.documentationUrl === 'string' ? card.documentationUrl : null,
  }
}
