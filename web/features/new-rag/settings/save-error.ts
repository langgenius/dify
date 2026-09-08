import { zKnowledgeFsPublicFailureResponse } from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { knowledgeFsTaskFailureMessageKey } from '../knowledge-fs-task-error'

export async function settingsSaveErrorMessageKey(error: unknown) {
  if (!(error instanceof Response)) return 'settings.saveFailed' as const
  if (error.status === 403) return 'permissionRestricted' as const
  try {
    const body: unknown = await error.clone().json()
    if (typeof body === 'object' && body !== null && 'failure' in body) {
      const failure = zKnowledgeFsPublicFailureResponse.safeParse(body.failure)
      if (failure.success)
        return knowledgeFsTaskFailureMessageKey(failure.data) ?? 'settings.saveFailed'
    }
  } catch {
    // Never expose untrusted provider messages or turn a malformed error into a second failure.
  }
  return 'settings.saveFailed' as const
}
