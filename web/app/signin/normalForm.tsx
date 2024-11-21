import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { RiContractLine, RiDoorLockLine, RiErrorWarningFill } from '@remixicon/react'
import Loading from '../components/base/loading'
import MailAndCodeAuth from './components/mail-and-code-auth'
import MailAndPasswordAuth from './components/mail-and-password-auth'
import SocialAuth from './components/social-auth'
import SSOAuth from './components/sso-auth'
import cn from '@/utils/classnames'
import { getSystemFeatures, invitationCheck } from '@/service/common'
import { LicenseStatus, defaultSystemFeatures } from '@/types/feature'
import Toast from '@/app/components/base/toast'
import { IS_CE_EDITION } from '@/config'

const NormalForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const consoleToken = decodeURIComponent(searchParams.get('access_token') || '')
  const refreshToken = decodeURIComponent(searchParams.get('refresh_token') || '')
  const message = decodeURIComponent(searchParams.get('message') || '')
  const invite_token = decodeURIComponent(searchParams.get('invite_token') || '')
  const [isLoading, setIsLoading] = useState(true)
  const [systemFeatures, setSystemFeatures] = useState(defaultSystemFeatures)
  const [authType, updateAuthType] = useState<'code' | 'password'>('password')
  const [showORLine, setShowORLine] = useState(false)
  const [allMethodsAreDisabled, setAllMethodsAreDisabled] = useState(false)
  const [workspaceName, setWorkSpaceName] = useState('')

  const isInviteLink = Boolean(invite_token && invite_token !== 'null')

  const init = useCallback(async () => {
    try {
      if (consoleToken && refreshToken) {
        localStorage.setItem('console_token', consoleToken)
        localStorage.setItem('refresh_token', refreshToken)
        router.replace('/apps')
        return
      }

      if (message) {
        Toast.notify({
          type: 'error',
          message,
        })
      }
      const features = await getSystemFeatures()
      const allFeatures = { ...defaultSystemFeatures, ...features }
      setSystemFeatures(allFeatures)
      setAllMethodsAreDisabled(!allFeatures.enable_social_oauth_login && !allFeatures.enable_email_code_login && !allFeatures.enable_email_password_login && !allFeatures.sso_enforced_for_signin)
      setShowORLine((allFeatures.enable_social_oauth_login || allFeatures.sso_enforced_for_signin) && (allFeatures.enable_email_code_login || allFeatures.enable_email_password_login))
      updateAuthType(allFeatures.enable_email_password_login ? 'password' : 'code')
      if (isInviteLink) {
        const checkRes = await invitationCheck({
          url: '/activate/check',
          params: {
            token: invite_token,
          },
        })
        setWorkSpaceName(checkRes?.data?.workspace_name || '')
      }
    }
    catch (error) {
      console.error(error)
      setAllMethodsAreDisabled(true)
      setSystemFeatures(defaultSystemFeatures)
    }
    finally { setIsLoading(false) }
  }, [consoleToken, refreshToken, message, router, invite_token, isInviteLink])
  useEffect(() => {
    init()
  }, [init])
  if (isLoading || consoleToken) {
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
  if (systemFeatures.license?.status === LicenseStatus.LOST) {
    return <div className='w-full mx-auto mt-8'>
      <div className='bg-white'>
        <div className="p-4 rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2">
          <div className='flex items-center justify-center w-10 h-10 rounded-xl bg-components-card-bg shadow shadows-shadow-lg mb-2 relative'>
            <RiContractLine className='w-5 h-5' />
            <RiErrorWarningFill className='absolute w-4 h-4 text-text-warning-secondary -top-1 -right-1' />
          </div>
          <p className='system-sm-medium text-text-primary'>{t('login.licenseLost')}</p>
          <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.licenseLostTip')}</p>
        </div>
      </div>
    </div>
  }
  if (systemFeatures.license?.status === LicenseStatus.EXPIRED) {
    return <div className='w-full mx-auto mt-8'>
      <div className='bg-white'>
        <div className="p-4 rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2">
          <div className='flex items-center justify-center w-10 h-10 rounded-xl bg-components-card-bg shadow shadows-shadow-lg mb-2 relative'>
            <RiContractLine className='w-5 h-5' />
            <RiErrorWarningFill className='absolute w-4 h-4 text-text-warning-secondary -top-1 -right-1' />
          </div>
          <p className='system-sm-medium text-text-primary'>{t('login.licenseExpired')}</p>
          <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.licenseExpiredTip')}</p>
        </div>
      </div>
    </div>
  }
  if (systemFeatures.license?.status === LicenseStatus.INACTIVE) {
    return <div className='w-full mx-auto mt-8'>
      <div className='bg-white'>
        <div className="p-4 rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2">
          <div className='flex items-center justify-center w-10 h-10 rounded-xl bg-components-card-bg shadow shadows-shadow-lg mb-2 relative'>
            <RiContractLine className='w-5 h-5' />
            <RiErrorWarningFill className='absolute w-4 h-4 text-text-warning-secondary -top-1 -right-1' />
          </div>
          <p className='system-sm-medium text-text-primary'>{t('login.licenseInactive')}</p>
          <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.licenseInactiveTip')}</p>
        </div>
      </div>
    </div>
  }

  return (
    <>
      <div className="w-full mx-auto mt-8">
        {isInviteLink
          ? <div className="w-full mx-auto">
            <h2 className="title-4xl-semi-bold text-text-primary">{t('login.join')}{workspaceName}</h2>
            <p className='mt-2 body-md-regular text-text-tertiary'>{t('login.joinTipStart')}{workspaceName}{t('login.joinTipEnd')}</p>
          </div>
          : <div className="w-full mx-auto">
            <h2 className="title-4xl-semi-bold text-text-primary">{t('login.pageTitle')}</h2>
            <p className='mt-2 body-md-regular text-text-tertiary'>{t('login.welcome')}</p>
          </div>}
        <div className="bg-white">
          <div className="flex flex-col gap-3 mt-6">
            {systemFeatures.enable_social_oauth_login && <SocialAuth />}
            {systemFeatures.sso_enforced_for_signin && <div className='w-full'>
              <SSOAuth protocol={systemFeatures.sso_enforced_for_signin_protocol} />
            </div>}
          </div>

          {showORLine && <div className="relative mt-6">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className='bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent h-px w-full'></div>
            </div>
            <div className="relative flex justify-center">
              <span className="px-2 text-text-tertiary system-xs-medium-uppercase bg-white">{t('login.or')}</span>
            </div>
          </div>}
          {
            (systemFeatures.enable_email_code_login || systemFeatures.enable_email_password_login) && <>
              {systemFeatures.enable_email_code_login && authType === 'code' && <>
                <MailAndCodeAuth isInvite={isInviteLink} />
                {systemFeatures.enable_email_password_login && <div className='cursor-pointer py-1 text-center' onClick={() => { updateAuthType('password') }}>
                  <span className='system-xs-medium text-components-button-secondary-accent-text'>{t('login.usePassword')}</span>
                </div>}
              </>}
              {systemFeatures.enable_email_password_login && authType === 'password' && <>
                <MailAndPasswordAuth isInvite={isInviteLink} allowRegistration={systemFeatures.is_allow_register} />
                {systemFeatures.enable_email_code_login && <div className='cursor-pointer py-1 text-center' onClick={() => { updateAuthType('code') }}>
                  <span className='system-xs-medium text-components-button-secondary-accent-text'>{t('login.useVerificationCode')}</span>
                </div>}
              </>}
            </>
          }
          {allMethodsAreDisabled && <>
            <div className="p-4 rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2">
              <div className='flex items-center justify-center w-10 h-10 rounded-xl bg-components-card-bg shadow shadows-shadow-lg mb-2'>
                <RiDoorLockLine className='w-5 h-5' />
              </div>
              <p className='system-sm-medium text-text-primary'>{t('login.noLoginMethod')}</p>
              <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.noLoginMethodTip')}</p>
            </div>
            <div className="relative my-2 py-2">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className='bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent h-px w-full'></div>
              </div>
            </div>
          </>}
          <div className="w-full block mt-2 system-xs-regular text-text-tertiary">
            {t('login.tosDesc')}
            &nbsp;
            <Link
              className='system-xs-medium text-text-secondary hover:underline'
              target='_blank' rel='noopener noreferrer'
              href='https://dify.ai/terms'
            >{t('login.tos')}</Link>
            &nbsp;&&nbsp;
            <Link
              className='system-xs-medium text-text-secondary hover:underline'
              target='_blank' rel='noopener noreferrer'
              href='https://dify.ai/privacy'
            >{t('login.pp')}</Link>
          </div>
          {IS_CE_EDITION && <div className="w-hull block mt-2 system-xs-regular text-text-tertiary">
            {t('login.goToInit')}
            &nbsp;
            <Link
              className='system-xs-medium text-text-secondary hover:underline'
              href='/install'
            >{t('login.setAdminAccount')}</Link>
          </div>}

        </div>
      </div>
    </>
  )
}

export default NormalForm
