'use client'
import cn from 'classnames'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import { fetchSystemFeatures, fetchWebOAuth2SSOUrl, fetchWebOIDCSSOUrl, fetchWebSAMLSSOUrl } from '@/service/share'
import LogoSite from '@/app/components/base/logo/logo-site'
import { setAccessToken } from '@/app/components/share/utils'

const WebSSOForm: FC = () => {
  const searchParams = useSearchParams()

  const redirectUrl = searchParams.get('redirect_url')
  const tokenFromUrl = searchParams.get('web_sso_token')
  const message = searchParams.get('message')

  const router = useRouter()
  const { t } = useTranslation()

  const [isLoading, setIsLoading] = useState(false)
  const [protocol, setProtocol] = useState('')

  useEffect(() => {
    const fetchFeaturesAndSetToken = async () => {
      await fetchSystemFeatures().then((res) => {
        setProtocol(res.sso_enforced_for_web_protocol)
      })

      // Callback from SSO, process token and redirect
      if (tokenFromUrl && redirectUrl) {
        const appCode = redirectUrl.split('/').pop()
        if (!appCode) {
          Toast.notify({
            type: 'error',
            message: 'redirect url is invalid. App code is not found.',
          })
          return
        }

        await setAccessToken(appCode, tokenFromUrl)
        router.push(redirectUrl)
      }
    }

    fetchFeaturesAndSetToken()

    if (message) {
      Toast.notify({
        type: 'error',
        message,
      })
    }
  }, [])

  const handleSSOLogin = () => {
    setIsLoading(true)

    if (!redirectUrl) {
      Toast.notify({
        type: 'error',
        message: 'redirect url is not found.',
      })
      setIsLoading(false)
      return
    }

    const appCode = redirectUrl.split('/').pop()
    if (!appCode) {
      Toast.notify({
        type: 'error',
        message: 'redirect url is invalid. App code is not found.',
      })
      return
    }

    if (protocol === 'saml') {
      fetchWebSAMLSSOUrl(appCode, redirectUrl).then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocol === 'oidc') {
      fetchWebOIDCSSOUrl(appCode, redirectUrl).then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocol === 'oauth2') {
      fetchWebOAuth2SSOUrl(appCode, redirectUrl).then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else {
      Toast.notify({
        type: 'error',
        message: 'sso protocol is not supported.',
      })
      setIsLoading(false)
    }
  }

  return (
    <div className={cn(
      'flex w-full min-h-screen',
      'sm:p-4 lg:p-8',
      'gap-x-20',
      'justify-center lg:justify-start',
    )}>
      <div className={
        cn(
          'flex w-full flex-col bg-white shadow rounded-2xl shrink-0',
          'space-between',
        )
      }>
        <div className='flex items-center justify-between p-6 w-full'>
          <LogoSite />
        </div>

        <div className={
          cn(
            'flex flex-col items-center w-full grow items-center justify-center',
            'px-6',
            'md:px-[108px]',
          )
        }>
          <div className='flex flex-col md:w-[400px]'>
            <div className="w-full mx-auto">
              <h2 className="text-[32px] font-bold text-gray-900">{t('login.pageTitle')}</h2>
            </div>
            <div className="w-full mx-auto mt-10">
              <Button
                tabIndex={0}
                variant='primary'
                onClick={() => { handleSSOLogin() }}
                disabled={isLoading}
                className="w-full !text-sm"
              >{t('login.sso')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(WebSSOForm)
