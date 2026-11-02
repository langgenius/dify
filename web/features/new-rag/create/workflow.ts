import type {
  KnowledgeFsControlSpaceVisibility,
  KnowledgeFsModelIntent,
  KnowledgeFsSpaceCreatePayload,
  KnowledgeFsSpaceCreateResponse,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { CreationModelSelections } from './use-creation-models'
import type { ModelSelectorValue } from '@/app/components/header/account-setting/model-provider-page/model-selector/types'
import { consoleClient } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { KNOWLEDGE_DESCRIPTION_MAX_LENGTH, KNOWLEDGE_NAME_MAX_LENGTH } from '../constants'

export const NAME_MAX_LENGTH = KNOWLEDGE_NAME_MAX_LENGTH
export const DESCRIPTION_MAX_LENGTH = KNOWLEDGE_DESCRIPTION_MAX_LENGTH

export type KnowledgeVisibility = KnowledgeFsControlSpaceVisibility

type CreateKnowledgeValues = {
  existingKnowledge?: KnowledgeFsSpaceCreateResponse
  description: string
  idempotencyKey: string
  initialSource?: NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>
  members?: KnowledgeFsSpaceCreatePayload['members']
  name: string
  models?: CreationModelSelections
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

class KnowledgeSpaceProvisioningError extends Error {
  readonly state?: KnowledgeFsSpaceDetailResponse['state']

  constructor(message: string, state?: KnowledgeFsSpaceDetailResponse['state']) {
    super(message)
    this.name = 'KnowledgeSpaceProvisioningError'
    this.state = state
  }
}

function isRetryableProvisioningReadError(error: unknown) {
  const status = getHttpErrorStatus(error)
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
  const status = getHttpErrorStatus(error)
  return status === 400 || status === 401 || status === 403 || status === 422
}

function modelSelection(selection: ModelSelectorValue): KnowledgeFsModelIntent {
  const { model } = selection
  const providerParts = selection.provider.split('/').filter(Boolean)
  const provider = providerParts.pop()
  const pluginId = selection.plugin_id || providerParts.join('/')
  if (!model.trim() || !pluginId || !provider)
    throw new Error('The selected model provider identity is incomplete')

  return { model, plugin_id: pluginId, provider }
}

function initialModelConfiguration(models: CreationModelSelections | undefined) {
  if (!models) throw new Error('Select the reasoning, embedding, and rerank models before creation')

  return {
    embedding: modelSelection(models.embedding),
    retrieval: {
      default_mode: 'fast',
      reasoning_model: modelSelection(models.reasoning),
      rerank: { enabled: true, model: modelSelection(models.rerank) },
      score_threshold: { enabled: false, stage: 'rerank' },
      top_k: 10,
    },
  } satisfies Pick<KnowledgeFsSpaceCreatePayload, 'embedding' | 'retrieval'>
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
      modelConfiguration = initialModelConfiguration(values.models)
    } catch (error) {
      throw new KnowledgeCreationError(error, 'preflight')
    }
    try {
      created = await consoleClient.knowledgeFs.spaces.post({
        body: {
          description: values.description || undefined,
          idempotency_key: values.idempotencyKey,
          initial_source: values.initialSource,
          ...(values.visibility === 'partial_members' ? { members: values.members } : {}),
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
