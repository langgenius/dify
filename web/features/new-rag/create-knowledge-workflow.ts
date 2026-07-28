import type {
  KnowledgeFsControlSpaceVisibility,
  KnowledgeFsModelIntent,
  KnowledgeFsSpaceCreatePayload,
  KnowledgeFsSpaceCreateResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { consoleClient } from '@/service/client'

export const NAME_MAX_LENGTH = 160
export const DESCRIPTION_MAX_LENGTH = 2000

export type KnowledgeVisibility = Extract<
  KnowledgeFsControlSpaceVisibility,
  'all_team_members' | 'only_me'
>

type CreateKnowledgeValues = {
  existingKnowledge?: KnowledgeFsSpaceCreateResponse
  description: string
  idempotencyKey: string
  name: string
  onCreated: (knowledgeSpace: KnowledgeFsSpaceCreateResponse) => void
  visibility: KnowledgeVisibility
}

export class KnowledgeCreationError extends Error {
  readonly originalError: unknown
  readonly reason?: 'defaultModelsRequired'
  readonly stage: 'preflight' | 'request'

  constructor(
    originalError: unknown,
    stage: 'preflight' | 'request',
    reason?: 'defaultModelsRequired',
  ) {
    super('Knowledge creation failed')
    this.name = 'KnowledgeCreationError'
    this.originalError = originalError
    this.reason = reason
    this.stage = stage
  }
}

function responseStatus(error: unknown) {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error) return error.status
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data) return data.status
  }
}

export function isDefinitiveCreationRejection(error: unknown) {
  const status = responseStatus(error)
  return status === 400 || status === 401 || status === 403 || status === 422
}

function modelSelection(model: string, canonicalProvider: string): KnowledgeFsModelIntent {
  const providerParts = canonicalProvider.split('/').filter(Boolean)
  const provider = providerParts.pop()
  const pluginId = providerParts.join('/')
  if (!model.trim() || !pluginId || !provider)
    throw new Error('The default model provider identity is incomplete')

  return { model, plugin_id: pluginId, provider }
}

async function getDefaultModelSelection(
  modelType: 'llm' | 'text-embedding',
): Promise<KnowledgeFsModelIntent | undefined> {
  const response = await consoleClient.workspaces.current.defaultModel.get({
    query: { model_type: modelType },
  })
  if (!response.data) return undefined
  return modelSelection(response.data.model, response.data.provider.provider)
}

async function defaultModelConfiguration(): Promise<
  Pick<KnowledgeFsSpaceCreatePayload, 'embedding' | 'retrieval'>
> {
  const [embedding, reasoningModel] = await Promise.all([
    getDefaultModelSelection('text-embedding'),
    getDefaultModelSelection('llm'),
  ])
  if (!embedding || !reasoningModel) {
    throw new KnowledgeCreationError(
      new Error('Default embedding and reasoning models are required'),
      'preflight',
      'defaultModelsRequired',
    )
  }

  return {
    embedding,
    retrieval: {
      default_mode: 'fast',
      reasoning_model: reasoningModel,
      rerank: { enabled: false },
      score_threshold: { enabled: false, stage: 'mode-final' },
      top_k: 10,
    },
  }
}

function knowledgeSlug(name: string, idempotencyKey: string) {
  const normalizedName = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const suffix = idempotencyKey
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12)
  const base = normalizedName || 'knowledge'
  return `${base.slice(0, 147 - suffix.length)}-${suffix}`
}

export async function createKnowledge(
  values: CreateKnowledgeValues,
): Promise<KnowledgeFsSpaceCreateResponse> {
  let created = values.existingKnowledge
  if (!created) {
    let modelConfiguration: Pick<KnowledgeFsSpaceCreatePayload, 'embedding' | 'retrieval'>
    try {
      modelConfiguration = await defaultModelConfiguration()
    } catch (error) {
      if (error instanceof KnowledgeCreationError) throw error
      throw new KnowledgeCreationError(error, 'preflight')
    }
    try {
      created = await consoleClient.knowledgeFs.spaces.post({
        body: {
          description: values.description || undefined,
          idempotency_key: values.idempotencyKey,
          ...modelConfiguration,
          name: values.name,
          slug: knowledgeSlug(values.name, values.idempotencyKey),
          visibility: values.visibility,
        },
      })
    } catch (error) {
      throw new KnowledgeCreationError(error, 'request')
    }
  }
  values.onCreated(created)
  return created
}
