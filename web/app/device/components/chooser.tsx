'use client'

import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { setPostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
import { useRouter } from '@/next/navigation'

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
    window.location.href = `/openapi/v1/oauth/device/sso-initiate?user_code=${encodeURIComponent(userCode)}`
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="primary"
        size="large"
        className="w-full gap-2"
        onClick={onAccount}
      >
        <span className="i-ri-user-3-line h-4 w-4" />
        Sign in with Dify account
      </Button>
      {ssoAvailable && (
        <Button
          variant="secondary"
          size="large"
          className="w-full gap-2"
          onClick={onSSO}
        >
          <span className="i-ri-shield-line h-4 w-4" />
          Sign in with SSO
        </Button>
      )}
    </div>
  )
}

export default Chooser
