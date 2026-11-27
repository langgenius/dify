import { ORPCError } from '@orpc/client'
import { markErrorHandled } from '@/service/handled-error'

/**
 * Setup and init validation answer `already_setup` once Dify is installed, so the user goes to
 * sign in instead and the failure is not reported.
 */
export function leaveCompletedSetup(error: unknown, replace: (href: string) => void) {
  if (!(error instanceof ORPCError) || error.status !== 403 || error.code !== 'already_setup')
    return false
  markErrorHandled(error)
  replace('/signin')
  return true
}
