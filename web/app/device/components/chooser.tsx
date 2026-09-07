'use client'

import type { FC } from 'react'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { setPostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
import Link from '@/next/link'

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
  const { t } = useTranslation('deviceFlow')
  const deviceReturnPath = `/device?user_code=${encodeURIComponent(userCode)}`

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/signin"
        className={cn(buttonVariants({ variant: 'primary', size: 'large' }), 'w-full')}
        onClick={() => setPostLoginRedirect(deviceReturnPath)}
      >
        <span className="i-ri-user-3-line h-4 w-4" />
        {t(($) => $['chooser.signInAccount'])}
      </Link>
      {ssoAvailable && (
        <a
          href={`/openapi/v1/oauth/device/sso-initiate?user_code=${encodeURIComponent(userCode)}`}
          className={cn(buttonVariants({ variant: 'secondary', size: 'large' }), 'w-full')}
        >
          <span className="i-ri-shield-line h-4 w-4" />
          {t(($) => $['chooser.signInSSO'])}
        </a>
      )}
    </div>
  )
}

export default Chooser
