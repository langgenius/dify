import type { KnowledgeSpaceCreationResponse } from '@dify/contracts/knowledge-fs/types.gen'
import { consoleClient } from '@/service/client'

export const NAME_MAX_LENGTH = 160
export const DESCRIPTION_MAX_LENGTH = 2000

export type KnowledgeVisibility = 'all_members' | 'only_me'

type CreateKnowledgeValues = {
  existingKnowledge?: KnowledgeSpaceCreationResponse
  description: string
  idempotencyKey: string
  name: string
  onCreated: (knowledgeSpace: KnowledgeSpaceCreationResponse) => void
  visibility: KnowledgeVisibility
}

export class KnowledgeCreationError extends Error {
  readonly stage: 'create' | 'policy'
  readonly originalError: unknown
  readonly createdKnowledge?: KnowledgeSpaceCreationResponse

  constructor(
    stage: 'create' | 'policy',
    originalError: unknown,
    createdKnowledge?: KnowledgeSpaceCreationResponse,
  ) {
    super(`Knowledge creation failed during ${stage}`)
    this.name = 'KnowledgeCreationError'
    this.stage = stage
    this.originalError = originalError
    this.createdKnowledge = createdKnowledge
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

export async function createKnowledge(
  values: CreateKnowledgeValues,
): Promise<KnowledgeSpaceCreationResponse> {
  let created = values.existingKnowledge
  if (!created) {
    try {
      created = await consoleClient.knowledgeFs.createKnowledgeSpace({
        body: {
          description: values.description || undefined,
          idempotencyKey: values.idempotencyKey,
          name: values.name,
        },
      })
    } catch (error) {
      throw new KnowledgeCreationError('create', error)
    }
  }
  values.onCreated(created)

  try {
    if (values.visibility === 'all_members') {
      const policy = await consoleClient.knowledgeFs.getKnowledgeSpacesByIdAccessPolicy({
        params: { id: created.id },
      })
      if (policy.visibility !== values.visibility) {
        await consoleClient.knowledgeFs.patchKnowledgeSpacesByIdAccessPolicy({
          body: {
            expectedRevision: policy.revision,
            partialMemberSubjectIds: [],
            visibility: values.visibility,
          },
          params: { id: created.id },
        })
      }
    }
  } catch (error) {
    throw new KnowledgeCreationError('policy', error, created)
  }

  return created
}
