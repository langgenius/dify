import type { MemberInviteErrorResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { ORPCError } from '@orpc/client'

type InviteErrorCode = MemberInviteErrorResponse['code']

const INVITE_ERROR_CODES = new Set<InviteErrorCode>([
  'invalid_param',
  'invalid_role',
  'limit_exceeded',
])

export function getInviteErrorCode(error: unknown): InviteErrorCode | null {
  if (!(error instanceof ORPCError)) return null
  const code = error.code

  return INVITE_ERROR_CODES.has(code as InviteErrorCode) ? (code as InviteErrorCode) : null
}
