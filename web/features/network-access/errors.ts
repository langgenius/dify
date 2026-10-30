import type {
  AppNotFoundError,
  NetworkAccessUnsupportedAppModeError,
} from '@dify/contracts/api/console/apps/types.gen'
import type {
  NetworkAccessForbiddenError,
  NetworkAccessGroupNameConflictError,
  NetworkAccessNotEntitledError,
  NetworkAccessRoleDeniedError,
  NetworkAccessVersionConflictError,
  PaidPlanRequiredError,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { isDefinedError, ORPCError } from '@orpc/client'

type NetworkAccessErrorCode = (
  | AppNotFoundError
  | NetworkAccessForbiddenError
  | NetworkAccessGroupNameConflictError
  | NetworkAccessNotEntitledError
  | NetworkAccessRoleDeniedError
  | NetworkAccessUnsupportedAppModeError
  | NetworkAccessVersionConflictError
  | PaidPlanRequiredError
)['code']

export function hasNetworkAccessErrorCode(
  error: unknown,
  ...codes: NetworkAccessErrorCode[]
): boolean {
  return (
    error instanceof ORPCError && isDefinedError(error) && codes.some((code) => code === error.code)
  )
}
