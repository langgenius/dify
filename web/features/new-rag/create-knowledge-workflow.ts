import type {
  KnowledgeFsControlSpaceVisibility,
  KnowledgeFsModelIntent,
  KnowledgeFsSpaceCreatePayload,
  KnowledgeFsSpaceCreateResponse,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { consoleClient } from '@/service/client'
import { KNOWLEDGE_DESCRIPTION_MAX_LENGTH, KNOWLEDGE_NAME_MAX_LENGTH } from './constants'

export const NAME_MAX_LENGTH = KNOWLEDGE_NAME_MAX_LENGTH
export const DESCRIPTION_MAX_LENGTH = KNOWLEDGE_DESCRIPTION_MAX_LENGTH

export type KnowledgeVisibility = Extract<
  KnowledgeFsControlSpaceVisibility,
  'all_team_members' | 'only_me'
>

type CreateKnowledgeValues = {
  existingKnowledge?: KnowledgeFsSpaceCreateResponse
  description: string
  idempotencyKey: string
  initialSource?: NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>
  name: string
  onCreated: (knowledgeSpace: KnowledgeFsSpaceCreateResponse) => void
  visibility: KnowledgeVisibility
}

export type KnowledgeCreationResult = {
  knowledgeSpace: KnowledgeFsSpaceCreateResponse
  modelSetupRequired: boolean
}

export class KnowledgeCreationError extends Error {
  readonly originalError: unknown
  readonly stage: 'preflight' | 'request'

  constructor(originalError: unknown, stage: 'preflight' | 'request') {
    super('Knowledge creation failed')
    this.name = 'KnowledgeCreationError'
    this.originalError = originalError
    this.stage = stage
  }
}

const KNOWLEDGE_SPACE_READY_POLL_INTERVAL_MS = 1_000
const KNOWLEDGE_SPACE_READY_TIMEOUT_MS = 120_000

export class KnowledgeSpaceProvisioningError extends Error {
  readonly state?: KnowledgeFsSpaceDetailResponse['state']

  constructor(message: string, state?: KnowledgeFsSpaceDetailResponse['state']) {
    super(message)
    this.name = 'KnowledgeSpaceProvisioningError'
    this.state = state
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

function isRetryableProvisioningReadError(error: unknown) {
  const status = responseStatus(error)
  if (typeof status !== 'number') return true

  return (
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  )
}

function waitForNextProvisioningPoll(delayMs: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
}

export async function waitForKnowledgeSpaceReady(
  controlSpaceId: string,
): Promise<KnowledgeFsSpaceDetailResponse> {
  const deadline = Date.now() + KNOWLEDGE_SPACE_READY_TIMEOUT_MS

  while (true) {
    try {
      const space = await consoleClient.knowledgeFs.spaces.byControlSpaceId.get({
        params: { control_space_id: controlSpaceId },
      })
      if (space.state === 'active') {
        if (space.knowledge_space_id) return space
        throw new KnowledgeSpaceProvisioningError(
          'Knowledge space became active without a registered data-plane space',
          space.state,
        )
      }
      if (space.state !== 'provisioning')
        throw new KnowledgeSpaceProvisioningError(
          `Knowledge space provisioning stopped in state ${space.state}`,
          space.state,
        )
    } catch (error) {
      if (error instanceof KnowledgeSpaceProvisioningError) throw error
      if (!isRetryableProvisioningReadError(error)) throw error
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0)
      throw new KnowledgeSpaceProvisioningError('Knowledge space provisioning timed out')

    await waitForNextProvisioningPoll(Math.min(KNOWLEDGE_SPACE_READY_POLL_INTERVAL_MS, remainingMs))
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
  modelType: 'llm' | 'rerank' | 'text-embedding',
): Promise<KnowledgeFsModelIntent | undefined> {
  const response = await consoleClient.workspaces.current.defaultModel.get({
    query: { model_type: modelType },
  })
  if (!response.data) return undefined
  return modelSelection(response.data.model, response.data.provider.provider)
}

async function initialModelConfiguration(): Promise<
  Partial<Pick<KnowledgeFsSpaceCreatePayload, 'embedding' | 'retrieval'>>
> {
  const [embeddingResult, reasoningModelResult, rerankModelResult] = await Promise.allSettled([
    getDefaultModelSelection('text-embedding'),
    getDefaultModelSelection('llm'),
    getDefaultModelSelection('rerank'),
  ])
  const embedding = embeddingResult.status === 'fulfilled' ? embeddingResult.value : undefined
  const reasoningModel =
    reasoningModelResult.status === 'fulfilled' ? reasoningModelResult.value : undefined
  const rerankModel = rerankModelResult.status === 'fulfilled' ? rerankModelResult.value : undefined
  if (!embedding || !reasoningModel || !rerankModel) return {}

  return {
    embedding,
    retrieval: {
      default_mode: 'fast',
      reasoning_model: reasoningModel,
      rerank: { enabled: true, model: rerankModel },
      score_threshold: { enabled: false, stage: 'rerank' },
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
): Promise<KnowledgeCreationResult> {
  let created = values.existingKnowledge
  if (!created) {
    let modelConfiguration: Partial<Pick<KnowledgeFsSpaceCreatePayload, 'embedding' | 'retrieval'>>
    try {
      modelConfiguration = await initialModelConfiguration()
    } catch (error) {
      throw new KnowledgeCreationError(error, 'preflight')
    }
    try {
      created = await consoleClient.knowledgeFs.spaces.post({
        body: {
          description: values.description || undefined,
          idempotency_key: values.idempotencyKey,
          initial_source: values.initialSource,
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
  return {
    knowledgeSpace: created,
    modelSetupRequired: created.model_setup_required,
  }
}
