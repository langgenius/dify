import type {
  KnowledgeFsProductRetrievalProfile,
  KnowledgeFsProfileModelSelection,
  KnowledgeFsSettingsResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'

export const TOP_K_MIN = 1
export const TOP_K_MAX = 10
export const SCORE_THRESHOLD_MIN = 0
export const SCORE_THRESHOLD_MAX = 1

export type ExternalAccessDraft = {
  apiEnabled: boolean
  workflowEnabled: boolean
}

export type RetrievalSettingsDraft = {
  embeddingModel: DefaultModel | undefined
  reasoningModel: DefaultModel | undefined
  rerankModel: DefaultModel | undefined
  retrievalMode: KnowledgeFsProductRetrievalProfile['defaultMode']
  scoreThreshold: number
  scoreThresholdEnabled: boolean
  topK: number
}

function pluginIdForModel(model: DefaultModel) {
  if (model.plugin_id) return model.plugin_id
  const [organization, pluginName] = model.provider.split('/').filter(Boolean)
  if (organization && pluginName) return `${organization}/${pluginName}`
  return model.provider ? `langgenius/${model.provider}` : ''
}

function canonicalProvider(pluginId: string, provider: string) {
  if (provider.includes('/')) return provider
  return `${pluginId}/${provider}`
}

function providerSlugForModel(model: DefaultModel) {
  const pluginId = pluginIdForModel(model)
  const canonicalPrefix = `${pluginId}/`
  if (model.provider.startsWith(canonicalPrefix))
    return model.provider.slice(canonicalPrefix.length)
  return model.provider.split('/').filter(Boolean).at(-1) ?? model.provider
}

export function modelPayload(model: DefaultModel): KnowledgeFsProfileModelSelection {
  return {
    model: model.model,
    pluginId: pluginIdForModel(model),
    provider: providerSlugForModel(model),
  }
}

export function modelFingerprint(model: DefaultModel | undefined) {
  return JSON.stringify(
    model
      ? {
          model: model.model,
          pluginId: pluginIdForModel(model),
          provider: providerSlugForModel(model),
        }
      : null,
  )
}

export function retrievalFingerprint({
  retrievalMode,
  reasoningModel,
  rerankModel,
  scoreThreshold,
  scoreThresholdEnabled,
  topK,
}: RetrievalSettingsDraft) {
  return JSON.stringify({
    mode: retrievalMode,
    reasoningModel: modelFingerprint(reasoningModel),
    rerankModel: modelFingerprint(rerankModel),
    scoreThreshold,
    scoreThresholdEnabled,
    topK,
  })
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function retrievalDraftFromSettings(
  settings: KnowledgeFsSettingsResponse,
): RetrievalSettingsDraft {
  const embedding = settings.embedding
  const retrieval = settings.retrieval
  return {
    embeddingModel: embedding
      ? {
          model: embedding.model,
          plugin_id: embedding.plugin_id,
          provider: canonicalProvider(embedding.plugin_id, embedding.provider),
        }
      : undefined,
    reasoningModel: retrieval
      ? {
          model: retrieval.reasoning_model.model,
          plugin_id: retrieval.reasoning_model.plugin_id,
          provider: canonicalProvider(
            retrieval.reasoning_model.plugin_id,
            retrieval.reasoning_model.provider,
          ),
        }
      : undefined,
    rerankModel: retrieval?.rerank.model
      ? {
          model: retrieval.rerank.model.model,
          plugin_id: retrieval.rerank.model.pluginId,
          provider: canonicalProvider(
            retrieval.rerank.model.pluginId,
            retrieval.rerank.model.provider,
          ),
        }
      : undefined,
    retrievalMode: retrieval?.default_mode ?? 'fast',
    scoreThreshold: clamp(
      retrieval?.score_threshold.value ?? 0.5,
      SCORE_THRESHOLD_MIN,
      SCORE_THRESHOLD_MAX,
    ),
    scoreThresholdEnabled: retrieval?.score_threshold.enabled ?? false,
    topK: clamp(retrieval?.top_k ?? 3, TOP_K_MIN, TOP_K_MAX),
  }
}
