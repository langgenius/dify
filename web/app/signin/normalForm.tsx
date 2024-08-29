import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import Loading from '../components/base/loading'
import MailAndCodeAuth from './components/mail-and-code-auth'
import MailAndPasswordAuth from './components/mail-and-password-auth'
import SocialAuth from './components/social-auth'
import SSOAuth from './components/sso-auth'
import cn from '@/utils/classnames'
import { IS_CE_EDITION } from '@/config'
import { getSystemFeatures } from '@/service/common'
import { defaultSystemFeatures } from '@/types/feature'
import Toast from '@/app/components/base/toast'

const NormalForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const consoleToken = searchParams.get('console_token')
  const message = searchParams.get('message')
  const token = searchParams.get('token')
  const email = searchParams.get('email') || ''
  const spaceName = searchParams.get('space') || ''
  const [isLoading, setIsLoading] = useState(true)
  const [systemFeatures, setSystemFeatures] = useState(defaultSystemFeatures)
  const [authType, updateAuthType] = useState('password')
  const [showORLine, setShowORLine] = useState(false)

  const isInviteLink = Boolean(token && token !== 'null')

  useEffect(() => {
    if (consoleToken) {
      localStorage.setItem('console_token', consoleToken)
      router.replace('/apps')
      return
    }

    if (message) {
      Toast.notify({
        type: 'error',
        message,
      })
    }
    getSystemFeatures().then((res) => {
      setSystemFeatures({ ...defaultSystemFeatures, ...res })
      setShowORLine((res.enable_social_oauth_login || res.sso_enforced_for_signin) && (res.enable_email_code_login || res.enable_email_password_login))
    }).finally(() => {
      setIsLoading(false)
    })
  }, [consoleToken, message, router])
  if (isLoading) {
    return <div className={
      cn(
        'flex flex-col items-center w-full grow justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }>
      <Loading type='area' />
    </div>
  }

  return (
    <>
      <div className="w-full mx-auto mt-8">
        {token
          ? <div className="w-full mx-auto">
            <h2 className="text-2xl font-bold text-gray-900">{t('login.join')}{spaceName}</h2>
            <p className='mt-1 text-sm text-gray-600'>{t('login.joinTipStart')}{spaceName}{t('login.joinTipEnd')}</p>
          </div>
          : <div className="w-full mx-auto">
            <h2 className="text-2xl font-bold text-gray-900">{t('login.pageTitle')}</h2>
            <p className='mt-1 text-sm text-gray-600'>{t('login.welcome')}</p>
          </div>}
        <div className="bg-white ">
          <div className="flex flex-col gap-3 mt-6">
            {systemFeatures.enable_social_oauth_login && <SocialAuth />}
            {systemFeatures.sso_enforced_for_signin && <div className='w-full'>
              <SSOAuth protocol={systemFeatures.sso_enforced_for_signin_protocol} />
            </div>}
          </div>

          {showORLine && <div className="relative mt-6">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 text-gray-300 bg-white">{t('login.or')}</span>
            </div>
          </div>}
          {
            (systemFeatures.enable_email_code_login || systemFeatures.enable_email_password_login) && <>
              {systemFeatures.enable_email_code_login && authType === 'code' && <>
                <MailAndCodeAuth isInvite={isInviteLink} />
                {systemFeatures.enable_email_password_login && <div className='cursor-pointer py-1 text-center' onClick={() => { updateAuthType('password') }}>
                  <span className='text-xs text-components-button-secondary-accent-text'>{t('login.usePassword')}</span>
                </div>}
              </>}
              {systemFeatures.enable_email_password_login && authType === 'password' && <>
                <MailAndPasswordAuth isInvite={isInviteLink} />
                {systemFeatures.enable_email_code_login && <div className='cursor-pointer py-1 text-center' onClick={() => { updateAuthType('code') }}>
                  <span className='text-xs text-components-button-secondary-accent-text'>{t('login.useVerificationCode')}</span>
                </div>}
              </>}
            </>
          }
          <div className="w-hull text-center block mt-2 text-xs text-gray-600">
            {t('login.tosDesc')}
            &nbsp;
            <Link
              className='text-primary-600'
              target='_blank' rel='noopener noreferrer'
              href='https://dify.ai/terms'
            >{t('login.tos')}</Link>
            &nbsp;&&nbsp;
            <Link
              className='text-primary-600'
              target='_blank' rel='noopener noreferrer'
              href='https://dify.ai/privacy'
            >{t('login.pp')}</Link>
          </div>

          {IS_CE_EDITION && <div className="w-hull text-center block mt-2 text-xs text-gray-600">
            {t('login.goToInit')}
            &nbsp;
            <Link
              className='text-primary-600'
              href='/install'
            >{t('login.setAdminAccount')}</Link>
          </div>}

        </div>
      </div>
    </>
  )
}

export default NormalForm
