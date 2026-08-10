import type { KnowledgeRetrievalV2Mode, KnowledgeRetrievalV2SpaceSummary } from './types'

const MAX_CONTROL_SPACES = 10
const MAX_FILTER_VALUES = 100

export const parseMetadataFilterValues = (value: string): string[] => {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_FILTER_VALUES)
}

export const toggleControlSpaceId = (selected: string[], controlSpaceId: string): string[] => {
  if (selected.includes(controlSpaceId)) return selected.filter((id) => id !== controlSpaceId)
  if (selected.length >= MAX_CONTROL_SPACES) return selected
  return [...selected, controlSpaceId]
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

const firstRecord = (value: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const candidate = asRecord(value?.[key])
    if (candidate) return candidate
  }
}

const firstString = (value: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const candidate = value?.[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
}

const firstNumber = (value: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const candidate = value?.[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
}

export const toControlSpaceSummary = (space: {
  control_space_id: string
  technical_summary?: {
    icon?: string | null
    model_profile?: Record<string, unknown> | null
    name: string
  } | null
}): KnowledgeRetrievalV2SpaceSummary => {
  const modelProfile = asRecord(space.technical_summary?.model_profile)
  const pending = firstRecord(
    modelProfile,
    'pendingModelConfiguration',
    'pending_model_configuration',
  )
  const profile =
    firstRecord(modelProfile, 'retrievalProfile', 'retrieval_profile') ??
    firstRecord(pending, 'retrievalProfile', 'retrieval_profile')
  const mode = firstString(profile, 'defaultMode', 'default_mode')
  const rerank = firstRecord(profile, 'rerank')

  return {
    control_space_id: space.control_space_id,
    name: space.technical_summary?.name ?? space.control_space_id,
    icon: space.technical_summary?.icon,
    default_mode:
      mode === 'fast' || mode === 'deep' || mode === 'research'
        ? (mode as KnowledgeRetrievalV2Mode)
        : undefined,
    top_k: firstNumber(profile, 'topK', 'top_k'),
    rerank_enabled: typeof rerank?.enabled === 'boolean' ? rerank.enabled : undefined,
  }
}
