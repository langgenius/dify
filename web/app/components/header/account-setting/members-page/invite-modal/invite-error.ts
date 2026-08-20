import type { MemberInviteErrorResponse } from '@dify/contracts/api/console/workspaces/types.gen'

function getRecord(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

export function getInviteErrorCode(error: unknown): MemberInviteErrorResponse['code'] | null {
  const errorRecord = getRecord(error)
  const dataRecord = getRecord(errorRecord?.data)
  const bodyRecord = getRecord(dataRecord?.body)
  const code = bodyRecord?.code ?? errorRecord?.code

  return code === 'invalid_param' || code === 'invalid_role' ? code : null
}
