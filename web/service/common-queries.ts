import { discardRegistrationSessionState } from '@/app/components/base/amplitude/registration-session-state'
import { resetUser } from '@/app/components/base/amplitude/utils'
import { clearPageLeaveGuards, confirmPageLeave } from '@/utils/page-leave-guard'
import { basePath } from '@/utils/var'
import { consoleQuery } from './console'

export function logoutMutationOptions({ redirectTo = '/signin' }: { redirectTo?: string } = {}) {
  return consoleQuery.logout.post.mutationOptions({
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
  })
}
