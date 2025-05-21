'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RiDoorLockLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Toast from '@/app/components/base/toast'
import { fetchWebOAuth2SSOUrl, fetchWebOIDCSSOUrl, fetchWebSAMLSSOUrl } from '@/service/share'
import { setAccessToken } from '@/app/components/share/utils'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { SSOProtocol } from '@/types/feature'
import Loading from '@/app/components/base/loading'
import AppUnavailable from '@/app/components/base/app-unavailable'

const WebSSOForm: FC = () => {
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const searchParams = useSearchParams()
  const router = useRouter()

  const redirectUrl = searchParams.get('redirect_url')
  const tokenFromUrl = searchParams.get('web_sso_token')
  const message = searchParams.get('message')

  const showErrorToast = (message: string) => {
    Toast.notify({
      type: 'error',
      message,
    })
  }

  const getAppCodeFromRedirectUrl = useCallback(() => {
    const appCode = redirectUrl?.split('/').pop()
    if (!appCode)
      return null

    return appCode
  }, [redirectUrl])

  const processTokenAndRedirect = useCallback(async () => {
    const appCode = getAppCodeFromRedirectUrl()
    if (!appCode || !tokenFromUrl || !redirectUrl) {
      showErrorToast('redirect url or app code or token is invalid.')
      return
    }

    await setAccessToken(appCode, tokenFromUrl)
    router.push(redirectUrl)
  }, [getAppCodeFromRedirectUrl, redirectUrl, router, tokenFromUrl])

  const handleSSOLogin = useCallback(async () => {
    const appCode = getAppCodeFromRedirectUrl()
    if (!appCode || !redirectUrl) {
      showErrorToast('redirect url or app code is invalid.')
      return
    }

    switch (systemFeatures.webapp_auth.sso_config.protocol) {
      case SSOProtocol.SAML: {
        const samlRes = await fetchWebSAMLSSOUrl(appCode, redirectUrl)
        router.push(samlRes.url)
        break
      }
      case SSOProtocol.OIDC: {
        const oidcRes = await fetchWebOIDCSSOUrl(appCode, redirectUrl)
        router.push(oidcRes.url)
        break
      }
      case SSOProtocol.OAuth2: {
        const oauth2Res = await fetchWebOAuth2SSOUrl(appCode, redirectUrl)
        router.push(oauth2Res.url)
        break
      }
      case '':
        break
      default:
        showErrorToast('SSO protocol is not supported.')
    }
  }, [getAppCodeFromRedirectUrl, redirectUrl, router, systemFeatures.webapp_auth.sso_config.protocol])

  useEffect(() => {
    const init = async () => {
      if (message) {
        showErrorToast(message)
        return
      }

      if (!tokenFromUrl) {
        await handleSSOLogin()
        return
      }

      await processTokenAndRedirect()
    }

    init()
  }, [message, processTokenAndRedirect, tokenFromUrl, handleSSOLogin])
  if (tokenFromUrl)
    return <div className='flex h-full items-center justify-center'><Loading /></div>
  if (message) {
    return <div className='flex h-full items-center justify-center'>
      <AppUnavailable code={'App Unavailable'} unknownReason={message} />
    </div>
  }

  if (systemFeatures.webapp_auth.enabled) {
    if (systemFeatures.webapp_auth.allow_sso) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className={cn('flex w-full grow flex-col items-center justify-center', 'px-6', 'md:px-[108px]')}>
            <Loading />
          </div>
        </div>
      )
    }
    return <div className="flex h-full items-center justify-center">
      <div className="rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
        <div className='shadows-shadow-lg mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-components-card-bg shadow'>
          <RiDoorLockLine className='h-5 w-5' />
        </div>
        <p className='system-sm-medium text-text-primary'>{t('login.webapp.noLoginMethod')}</p>
        <p className='system-xs-regular mt-1 text-text-tertiary'>{t('login.webapp.noLoginMethodTip')}</p>
      </div>
      <div className="relative my-2 py-2">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className='h-px w-full bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent'></div>
        </div>
      </div>
    </div>
  }
  else {
    return <div className="flex h-full items-center justify-center">
      <p className='system-xs-regular text-text-tertiary'>{t('login.webapp.disabled')}</p>
    </div>
  }
}

export default React.memo(WebSSOForm)
