import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiContractLine, RiDoorLockLine, RiErrorWarningFill } from '@remixicon/react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IS_CE_EDITION } from '@/config'
import { isLegacyBase401, userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { LicenseStatus } from '@/features/system-features/constants'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { invitationCheck } from '@/service/common'
import Loading from '../components/base/loading'
import MailAndCodeAuth from './components/mail-and-code-auth'
import MailAndPasswordAuth from './components/mail-and-password-auth'
import SocialAuth from './components/social-auth'
import SSOAuth from './components/sso-auth'
import Split from './split'
import { resolvePostLoginRedirect } from './utils/post-login-redirect'

type AuthType = 'code' | 'password'

function NormalForm() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Login probe: 401 stays as `error` (legitimate "not logged in" state on /signin),
  // other errors throw to error.tsx. jumpTo same-pathname guard in service/base.ts
  // prevents the redirect loop on 401.
  const {
    isPending: isCheckLoading,
    data: userResp,
    error: probeError,
  } = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: (err) => !isLegacyBase401(err),
    refetchOnWindowFocus: false,
  })
  const isLoggedIn = !!userResp && !probeError
  const message = decodeURIComponent(searchParams.get('message') || '')
  const inviteToken = decodeURIComponent(searchParams.get('invite_token') || '')
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [selectedAuthType, setSelectedAuthType] = useState<AuthType | null>(null)

  const isInviteLink = Boolean(inviteToken && inviteToken !== 'null')
  const {
    data: invitationCheckResp,
    isPending: isInviteCheckLoading,
    isError: isInviteCheckError,
  } = useQuery({
    queryKey: ['signin', 'invite-check', inviteToken],
    queryFn: () =>
      invitationCheck({
        url: '/activate/check',
        params: {
          token: inviteToken,
        },
      }),
    enabled: isInviteLink,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const workspaceName = invitationCheckResp?.data?.workspace_name || ''
  const hasSocialLogin = systemFeatures.enable_social_oauth_login
  const hasSsoLogin = Boolean(systemFeatures.sso_enforced_for_signin)
  const hasEmailCodeLogin = systemFeatures.enable_email_code_login
  const hasEmailPasswordLogin = systemFeatures.enable_email_password_login
  const hasEmailLogin = hasEmailCodeLogin || hasEmailPasswordLogin
  const defaultAuthType: AuthType = hasEmailPasswordLogin ? 'password' : 'code'
  const authType =
    selectedAuthType === 'password' && hasEmailPasswordLogin
      ? 'password'
      : selectedAuthType === 'code' && hasEmailCodeLogin
        ? 'code'
        : defaultAuthType
  const showORLine = (hasSocialLogin || hasSsoLogin) && hasEmailLogin
  const noLoginMethodsConfigured =
    !hasSocialLogin && !hasEmailCodeLogin && !hasEmailPasswordLogin && !hasSsoLogin
  const allMethodsAreDisabled = noLoginMethodsConfigured || isInviteCheckError
  const isLoading = isCheckLoading || isLoggedIn || (isInviteLink && isInviteCheckLoading)

  useEffect(() => {
    if (!isLoggedIn) return

    if (isInviteLink) {
      router.replace(`/signin/invite-settings?${searchParams.toString()}`)
      return
    }

    const redirectUrl = resolvePostLoginRedirect(searchParams)
    router.replace(redirectUrl || '/')
  }, [isInviteLink, isLoggedIn, router, searchParams])

  useEffect(() => {
    if (message) toast.error(message)
  }, [message])

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex w-full grow flex-col items-center justify-center',
          'px-6',
          'md:px-[108px]',
        )}
      >
        <Loading type="area" />
      </div>
    )
  }
  if (systemFeatures.license?.status === LicenseStatus.LOST) {
    return (
      <div className="mx-auto mt-8 w-full">
        <div className="relative">
          <div className="rounded-lg bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
            <div className="shadows-shadow-lg relative mb-2 flex size-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
              <RiContractLine className="size-5" />
              <RiErrorWarningFill className="absolute -top-1 -right-1 size-4 text-text-warning-secondary" />
            </div>
            <p className="system-sm-medium text-text-primary">
              {t(($) => $.licenseLost, { ns: 'login' })}
            </p>
            <p className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $.licenseLostTip, { ns: 'login' })}
            </p>
          </div>
        </div>
      </div>
    )
  }
  if (systemFeatures.license?.status === LicenseStatus.EXPIRED) {
    return (
      <div className="mx-auto mt-8 w-full">
        <div className="relative">
          <div className="rounded-lg bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
            <div className="shadows-shadow-lg relative mb-2 flex size-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
              <RiContractLine className="size-5" />
              <RiErrorWarningFill className="absolute -top-1 -right-1 size-4 text-text-warning-secondary" />
            </div>
            <p className="system-sm-medium text-text-primary">
              {t(($) => $.licenseExpired, { ns: 'login' })}
            </p>
            <p className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $.licenseExpiredTip, { ns: 'login' })}
            </p>
          </div>
        </div>
      </div>
    )
  }
  if (systemFeatures.license?.status === LicenseStatus.INACTIVE) {
    return (
      <div className="mx-auto mt-8 w-full">
        <div className="relative">
          <div className="rounded-lg bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
            <div className="shadows-shadow-lg relative mb-2 flex size-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
              <RiContractLine className="size-5" />
              <RiErrorWarningFill className="absolute -top-1 -right-1 size-4 text-text-warning-secondary" />
            </div>
            <p className="system-sm-medium text-text-primary">
              {t(($) => $.licenseInactive, { ns: 'login' })}
            </p>
            <p className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $.licenseInactiveTip, { ns: 'login' })}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mx-auto mt-8 w-full">
        {isInviteLink ? (
          <div className="mx-auto w-full">
            <h2 className="title-4xl-semi-bold text-text-primary">
              {t(($) => $.join, { ns: 'login' })}
              {workspaceName}
            </h2>
            {!systemFeatures.branding.enabled && (
              <p className="mt-2 body-md-regular text-text-tertiary">
                {t(($) => $.joinTipStart, { ns: 'login' })}
                {workspaceName}
                {t(($) => $.joinTipEnd, { ns: 'login' })}
              </p>
            )}
          </div>
        ) : (
          <div className="mx-auto w-full">
            <h2 className="title-4xl-semi-bold text-text-primary">
              {systemFeatures.branding.enabled
                ? t(($) => $.pageTitleForE, { ns: 'login' })
                : t(($) => $.pageTitle, { ns: 'login' })}
            </h2>
            <p className="mt-2 body-md-regular text-text-tertiary">
              {t(($) => $.welcome, { ns: 'login' })}
            </p>
          </div>
        )}
        <div className="relative">
          <div className="mt-6 flex flex-col gap-3">
            {hasSocialLogin && <SocialAuth />}
            {hasSsoLogin && (
              <div className="w-full">
                <SSOAuth protocol={systemFeatures.sso_enforced_for_signin_protocol} />
              </div>
            )}
          </div>

          {showORLine && (
            <div className="relative mt-6">
              <div className="flex items-center">
                <div className="h-px flex-1 bg-linear-to-r from-background-gradient-mask-transparent to-divider-regular"></div>
                <span className="px-3 system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $.or, { ns: 'login' })}
                </span>
                <div className="h-px flex-1 bg-linear-to-l from-background-gradient-mask-transparent to-divider-regular"></div>
              </div>
            </div>
          )}
          {hasEmailLogin && (
            <>
              {hasEmailCodeLogin && authType === 'code' && (
                <>
                  <MailAndCodeAuth isInvite={isInviteLink} />
                  {hasEmailPasswordLogin && (
                    <button
                      type="button"
                      className="w-full cursor-pointer py-1 text-center"
                      onClick={() => {
                        setSelectedAuthType('password')
                      }}
                    >
                      <span className="system-xs-medium text-components-button-secondary-accent-text">
                        {t(($) => $.usePassword, { ns: 'login' })}
                      </span>
                    </button>
                  )}
                </>
              )}
              {hasEmailPasswordLogin && authType === 'password' && (
                <>
                  <MailAndPasswordAuth
                    isInvite={isInviteLink}
                    isEmailSetup={systemFeatures.is_email_setup}
                  />
                  {hasEmailCodeLogin && (
                    <button
                      type="button"
                      className="w-full cursor-pointer py-1 text-center"
                      onClick={() => {
                        setSelectedAuthType('code')
                      }}
                    >
                      <span className="system-xs-medium text-components-button-secondary-accent-text">
                        {t(($) => $.useVerificationCode, { ns: 'login' })}
                      </span>
                    </button>
                  )}
                </>
              )}
              <Split className="mt-4 mb-5" />
            </>
          )}

          {systemFeatures.is_allow_register && authType === 'password' && (
            <div className="mb-3 text-[13px] leading-4 font-medium text-text-secondary">
              <span>{t(($) => $['signup.noAccount'], { ns: 'login' })}</span>
              <Link className="text-text-accent" href="/signup">
                {t(($) => $['signup.signUp'], { ns: 'login' })}
              </Link>
            </div>
          )}
          {allMethodsAreDisabled && (
            <>
              <div className="rounded-lg bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
                <div className="shadows-shadow-lg mb-2 flex size-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
                  <RiDoorLockLine className="size-5" />
                </div>
                <p className="system-sm-medium text-text-primary">
                  {t(($) => $.noLoginMethod, { ns: 'login' })}
                </p>
                <p className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $.noLoginMethodTip, { ns: 'login' })}
                </p>
              </div>
              <div className="relative my-2 py-2">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="h-px w-full bg-linear-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
                </div>
              </div>
            </>
          )}
          {!systemFeatures.branding.enabled && (
            <>
              <div className="mt-2 block w-full system-xs-regular text-text-tertiary">
                {t(($) => $.tosDesc, { ns: 'login' })}
                &nbsp;
                <Link
                  className="system-xs-medium text-text-secondary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://dify.ai/terms"
                >
                  {t(($) => $.tos, { ns: 'login' })}
                </Link>
                &nbsp;&&nbsp;
                <Link
                  className="system-xs-medium text-text-secondary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://dify.ai/privacy"
                >
                  {t(($) => $.pp, { ns: 'login' })}
                </Link>
              </div>
              {IS_CE_EDITION && (
                <div className="w-hull mt-2 block system-xs-regular text-text-tertiary">
                  {t(($) => $.goToInit, { ns: 'login' })}
                  &nbsp;
                  <Link
                    className="system-xs-medium text-text-secondary hover:underline"
                    href="/install"
                  >
                    {t(($) => $.setAdminAccount, { ns: 'login' })}
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default NormalForm
