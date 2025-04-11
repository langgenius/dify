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
import Button from '@/app/components/base/button'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { SSOProtocol } from '@/types/feature'

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

  const handleSSOLogin = async () => {
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
      default:
        showErrorToast('SSO protocol is not supported.')
    }
  }

  const goWebApp = () => {
    if (!redirectUrl) {
      showErrorToast('redirect url is invalid.')
      return
    }
    router.push(redirectUrl)
  }

  useEffect(() => {
    const init = async () => {
      if (message) {
        showErrorToast(message)
        return
      }

      if (!tokenFromUrl)
        return

      await processTokenAndRedirect()
    }

    init()
  }, [message, processTokenAndRedirect, tokenFromUrl])
  if (systemFeatures.webapp_auth.enabled) {
    if (systemFeatures.webapp_auth.allow_sso) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className={cn('flex flex-col items-center w-full grow justify-center', 'px-6', 'md:px-[108px]')}>
            <Button variant='primary' onClick={() => { handleSSOLogin() }}>{t('login.withSSO')}</Button>
          </div>
        </div>
      )
    }
    return <div className="flex items-center justify-center h-full">
      <div className="p-4 rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2">
        <div className='flex items-center justify-center w-10 h-10 rounded-xl bg-components-card-bg shadow shadows-shadow-lg mb-2'>
          <RiDoorLockLine className='w-5 h-5' />
        </div>
        <p className='system-sm-medium text-text-primary'>{t('login.webapp.noLoginMethod')}</p>
        <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.webapp.noLoginMethodTip')}</p>
      </div>
      <div className="relative my-2 py-2">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className='bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent h-px w-full'></div>
        </div>
      </div>
    </div>
  }
  else {
    return <div className="flex items-center justify-center h-full">
      <p className='system-xs-regular text-text-tertiary'>{t('login.webapp.disabled')}</p>
    </div>
  }
}

export default React.memo(WebSSOForm)
