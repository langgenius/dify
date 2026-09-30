import { knowledgeFsRequestFailureMessageKey } from '../knowledge-fs-task-error'

export async function settingsSaveErrorMessageKey(error: unknown) {
  if (!(error instanceof Response)) return 'settings.saveFailed' as const
  if (error.status === 403) return 'permissionRestricted' as const
  return (await knowledgeFsRequestFailureMessageKey(error)) ?? ('settings.saveFailed' as const)
}
