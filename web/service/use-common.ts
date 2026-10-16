import type { SchemaDefinitionItemResponse } from '@dify/contracts/api/console/spec/types.gen'
import type { CommonResponse } from '@/models/common'
import { useMutation, useQuery } from '@tanstack/react-query'
import { discardRegistrationSessionState } from '@/app/components/base/amplitude/registration-session-state'
import { resetUser } from '@/app/components/base/amplitude/utils'
import { clearPageLeaveGuards, confirmPageLeave } from '@/utils/page-leave-guard'
import { basePath } from '@/utils/var'
// oxlint-disable-next-line no-restricted-imports
import { post } from './base'
import { consoleQuery } from './console'

const NAME_SPACE = 'common'

const commonQueryKeys = {
  forgotPasswordValidity: (token?: string | null) =>
    [NAME_SPACE, 'forgot-password-validity', token] as const,
}

export type SchemaTypeDefinition = SchemaDefinitionItemResponse

export const useLogout = ({ redirectTo = '/signin' }: { redirectTo?: string } = {}) => {
  return useMutation(
    consoleQuery.logout.post.mutationOptions({
      onMutate: () => {
        // A cancelled native beforeunload prompt would otherwise leave this document
        // alive after the server has logged out. Obtain consent before ending the session.
        if (!confirmPageLeave()) throw new Error('Logout cancelled')
      },
      onSuccess: () => {
        // Registration markers and Analytics identity can survive a page reload,
        // so clear them explicitly after the server has ended the session.
        discardRegistrationSessionState()
        resetUser()
        // Client-side navigation keeps root providers and account-scoped stores alive.
        // QueryClient.clear() alone is insufficient: atomWithQuery caches observers
        // that can remain attached to removed Query instances and expose old results
        // when another account signs in with the same query keys (see #42809).
        // Replace the document to recreate all stores and observers for the next
        // session, without maintaining a reset dependency on every account-scoped atom.
        // Native navigation needs the deployment base path added explicitly; redirectTo
        // also preserves flow-specific sign-in parameters such as the OAuth return URL.
        // Consent was obtained before the request. Keep guards on failure, but remove
        // them on success so the browser cannot cancel the required document reset.
        clearPageLeaveGuards()
        window.location.replace(`${basePath}${redirectTo}`)
      },
    }),
  )
}

type ForgotPasswordValidity = CommonResponse & { is_valid: boolean; email: string; token: string }
// Not migrated to the console contract: the endpoint requires `email` and `code`, which the
// token-only reset link flow does not have, so this request cannot succeed as written.
export const useVerifyForgotPasswordToken = (token?: string | null) => {
  return useQuery<ForgotPasswordValidity>({
    queryKey: commonQueryKeys.forgotPasswordValidity(token),
    queryFn: () => post<ForgotPasswordValidity>('/forgot-password/validity', { body: { token } }),
    enabled: !!token,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}
