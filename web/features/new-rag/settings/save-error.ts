import { getHttpErrorStatus } from '@/service/http-error'
import { knowledgeFsRequestFailureMessageKey } from '../knowledge-fs-task-error'

export async function settingsSaveErrorMessageKey(error: unknown) {
  const status = getHttpErrorStatus(error) ?? (error instanceof Response ? error.status : undefined)
  if (status === undefined) return 'settings.saveFailed' as const
  if (status === 403) return 'permissionRestricted' as const
  return (await knowledgeFsRequestFailureMessageKey(error)) ?? ('settings.saveFailed' as const)
}
