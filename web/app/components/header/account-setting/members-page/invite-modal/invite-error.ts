import type { MemberInviteErrorResponse } from '@dify/contracts/api/console/workspaces/types.gen'

type InviteErrorCode = MemberInviteErrorResponse['code']

const INVITE_ERROR_CODES = new Set<InviteErrorCode>([
  'invalid_param',
  'invalid_role',
  'limit_exceeded',
])

function getRecord(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

export function getInviteErrorCode(error: unknown): InviteErrorCode | null {
  const errorRecord = getRecord(error)
  const dataRecord = getRecord(errorRecord?.data)
  const bodyRecord = getRecord(dataRecord?.body)
  const code = bodyRecord?.code ?? errorRecord?.code

  return typeof code === 'string' && INVITE_ERROR_CODES.has(code as InviteErrorCode)
    ? (code as InviteErrorCode)
    : null
}
