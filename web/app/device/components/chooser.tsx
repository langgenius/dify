'use client'

import type { FC } from 'react'
import { useRouter } from '@/next/navigation'
import { setPostLoginRedirect } from '@/app/signin/utils/post-login-redirect'

type Props = {
  userCode: string
  ssoAvailable: boolean
}

/**
 * Chooser renders the two-button device-auth login selector. Account button
 * seeds postLoginRedirect + navigates to /signin so every existing account
 * login method (password / email-code / social OAuth / account-SSO) flows
 * through its usual plumbing. SSO button hits /openapi/v1/oauth/device/sso-initiate
 * directly — the SSO branch skips /signin entirely.
 *
 * v1.0 scope: only account-SSO honours postLoginRedirect (via sso-auth's
 * return_to plumbing). Password / email-code / social-OAuth users land on
 * /signin's default post-login target and manually return to the /device
 * URL printed by the CLI. That's not great UX; a follow-up milestone
 * generalises post-signin redirect to all methods.
 */
const Chooser: FC<Props> = ({ userCode, ssoAvailable }) => {
  const router = useRouter()

  const onAccount = () => {
    setPostLoginRedirect(`/device?user_code=${encodeURIComponent(userCode)}`)
    router.push('/signin')
  }

  const onSSO = () => {
    // Full-page navigation, not router.push — /openapi/v1/oauth/device/sso-initiate
    // issues a 302 to the IdP. Next's client router can't follow cross-
    // origin redirects; a plain window.location assignment handles it.
    window.location.href = `/openapi/v1/oauth/device/sso-initiate?user_code=${encodeURIComponent(userCode)}`
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onAccount}
        className="rounded-lg bg-components-button-primary-bg px-4 py-3 text-components-button-primary-text font-medium hover:bg-components-button-primary-bg-hover"
      >
        Sign in with Dify account
      </button>
      {ssoAvailable && (
        <button
          onClick={onSSO}
          className="rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-4 py-3 text-components-button-secondary-text font-medium hover:bg-components-button-secondary-bg-hover"
        >
          Sign in with SSO
        </button>
      )}
    </div>
  )
}

export default Chooser
