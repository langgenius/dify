'use client'
import cn from 'classnames'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import { fetchWebOIDCSSOUrl, fetchWebSAMLSSOUrl } from '@/service/share'
import LogoSite from '@/app/components/base/logo/logo-site'

const EnterpriseWebSSOForm: FC = () => {
  const searchParams = useSearchParams()

  const protocal = searchParams.get('protocal')
  const webSSOTokenFromUrl = searchParams.get('web_sso_token')
  const message = searchParams.get('message')
  const [isChatbotApp, setIsChatbotApp] = useState(false)

  const router = useRouter()
  const { t } = useTranslation()

  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (webSSOTokenFromUrl) {
      localStorage.setItem('web_sso_token', webSSOTokenFromUrl)

      const redirectUrl = localStorage.getItem('web_app_redirect_url')
      if (redirectUrl) {
        if (redirectUrl.includes('/chatbot/'))
          setIsChatbotApp(true)

        else
          router.push(redirectUrl)
      }
    }

    if (message) {
      Toast.notify({
        type: 'error',
        message,
      })
    }
  }, [])

  const handleSSOLogin = () => {
    setIsLoading(true)
    if (protocal === 'saml') {
      fetchWebSAMLSSOUrl().then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else if (protocal === 'oidc') {
      fetchWebOIDCSSOUrl().then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else {
      Toast.notify({
        type: 'error',
        message: 'sso protocal is not supported.',
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
          {!isChatbotApp
            ? (
              <div className='flex flex-col md:w-[400px]'>
                <div className="w-full mx-auto">
                  <h2 className="text-[32px] font-bold text-gray-900">{t('login.pageTitle')}</h2>
                </div>
                <div className="w-full mx-auto mt-10">
                  <Button
                    tabIndex={0}
                    type='primary'
                    onClick={() => { handleSSOLogin() }}
                    disabled={isLoading}
                    className="w-full !fone-medium !text-sm"
                  >{t('login.sso')}
                  </Button>
                </div>
              </div>
            )
            : (
              <div className='flex flex-col md:w-[400px]'>
                <div className="w-full mx-auto">
                  <h2 className="text-[20px] font-bold text-gray-900">SSO login successfully.</h2>
                  <div>Please close this window and refresh the page.</div>
                </div>
                <div className="w-full mx-auto mt-10">
                  <Button
                    tabIndex={0}
                    type='primary'
                    disabled={isLoading}
                    className="w-full !fone-medium !text-sm"
                    onClick={() => {
                      window.close()
                    }}>
                    Close
                  </Button>
                </div>
              </div>)}
        </div>
      </div>
    </div>
  )
}

export default React.memo(EnterpriseWebSSOForm)
