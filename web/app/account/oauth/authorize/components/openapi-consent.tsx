'use client'

import type {
  OAuthAuthorizeClientResponse,
  OAuthAuthorizeRequest,
} from '@dify/contracts/api/openapi/types.gen'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { isUnauthorizedError } from '@/service/http-error'
import { approveAuthorize, denyAuthorize } from '@/service/oauth-authorize'
import { useLogout } from '@/service/use-common'
import { getAvatarInitial } from '@/utils/avatar'
import { buildReturnUrl } from '../use-silent-authorize'

type OpenApiConsentProps = {
  client: OAuthAuthorizeClientResponse
  searchParams: URLSearchParams
}

function buildApproveBody(
  client: OAuthAuthorizeClientResponse,
  searchParams: URLSearchParams,
): OAuthAuthorizeRequest {
  return {
    client_id: client.client_id,
    redirect_uri: searchParams.get('redirect_uri') ?? '',
    code_challenge: searchParams.get('code_challenge') ?? '',
    code_challenge_method: searchParams.get('code_challenge_method') ?? '',
    resource: searchParams.get('resource'),
    scope: searchParams.get('scope'),
    state: searchParams.get('state'),
  }
}

export function OpenApiConsent({ client, searchParams }: OpenApiConsentProps) {
  const { t } = useTranslation(['oauth', 'common'])
  const router = useRouter()
  const {
    data: userProfileResp,
    isPending: isProfileLoading,
    error: profileError,
  } = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: (err) => !isUnauthorizedError(err),
  })
  const isLoggedIn = !!userProfileResp && !profileError
  const userProfile = userProfileResp?.profile

  const returnUrl = buildReturnUrl('/account/oauth/authorize', `?${searchParams.toString()}`)
  const signInUrl = `/signin?redirect_url=${encodeURIComponent(returnUrl)}`
  const { mutateAsync: logout } = useLogout({ redirectTo: signInUrl })

  const decide = useMutation({
    mutationFn: ({ approve }: { approve: boolean }) => {
      const body = buildApproveBody(client, searchParams)
      return approve ? approveAuthorize(body) : denyAuthorize(body)
    },
    onSuccess: ({ redirect_to }) => {
      globalThis.location.href = redirect_to
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`${t(($) => $['error.authorizeFailed'], { ns: 'oauth' })}: ${message}`)
    },
  })

  useDocumentTitle(`${t(($) => $.connect, { ns: 'oauth' })} ${client.display_name}`)

  const onSwitchAccount = async () => {
    try {
      if (isLoggedIn) await logout()
      else router.push(signInUrl)
    } catch {
      // The request layer reports logout failures; keep the current session on this page.
    }
  }

  if (isProfileLoading) {
    return (
      <div className="bg-background-default-subtle">
        <LoadingPlaceholder className="h-full" />
      </div>
    )
  }

  return (
    <div className="bg-background-default-subtle">
      {client.logo_uri && (
        <div className="w-max rounded-2xl border-[0.5px] border-components-panel-border bg-text-primary-on-surface p-3 shadow-lg">
          <img src={client.logo_uri} alt="" className="size-10 rounded-sm" />
        </div>
      )}

      <div className="mt-5 mb-4 flex flex-col gap-2">
        <div className="title-4xl-semi-bold">
          <div className="text-text-primary">{t(($) => $.connect, { ns: 'oauth' })}</div>
          <div className="text-saas-dify-blue-inverted">{client.display_name}</div>
        </div>
        <div className="body-md-regular text-text-secondary">
          {isLoggedIn
            ? t(($) => $['openapi.tips.loggedIn'], { ns: 'oauth', name: client.display_name })
            : t(($) => $['tips.needLogin'], { ns: 'oauth' })}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl bg-background-section-burn-inverted p-3 body-sm-regular text-text-secondary">
        <div>{t(($) => $['openapi.redirectsTo'], { ns: 'oauth', host: client.redirect_host })}</div>
        {client.localhost_only && (
          <div role="alert" className="text-text-warning">
            {t(($) => $['openapi.localhostWarning'], { ns: 'oauth' })}
          </div>
        )}
      </div>

      {isLoggedIn && userProfile && (
        <div className="mt-2 flex items-center justify-between rounded-xl bg-background-section-burn-inverted p-3">
          <div className="flex items-center gap-2.5">
            <Avatar size="lg" aria-hidden="true">
              <AvatarFallback>{getAvatarInitial(userProfile.name)}</AvatarFallback>
              <AvatarImage src={userProfile.avatar_url || undefined} alt="" />
            </Avatar>
            <div>
              <div className="text-text-secondary">{userProfile.name}</div>
              <div className="system-xs-regular text-text-tertiary">{userProfile.email}</div>
            </div>
          </div>
          <Button variant="tertiary" size="small" onClick={onSwitchAccount}>
            {t(($) => $.switchAccount, { ns: 'oauth' })}
          </Button>
        </div>
      )}

      <div className="flex flex-col items-center gap-2 pt-4">
        {isLoggedIn ? (
          <>
            <Button
              variant="primary"
              size="large"
              className="w-full"
              onClick={() => decide.mutate({ approve: true })}
              disabled={decide.isPending}
              loading={decide.isPending && decide.variables.approve}
            >
              {t(($) => $['openapi.authorize'], { ns: 'oauth' })}
            </Button>
            <Button
              size="large"
              className="w-full"
              onClick={() => decide.mutate({ approve: false })}
              disabled={decide.isPending}
              loading={decide.isPending && !decide.variables.approve}
            >
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
          </>
        ) : (
          <Link
            href={signInUrl}
            className={cn(buttonVariants({ variant: 'primary', size: 'large' }), 'w-full')}
          >
            {t(($) => $.login, { ns: 'oauth' })}
          </Link>
        )}
      </div>
    </div>
  )
}
