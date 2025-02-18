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
        'flex w-full grow flex-col items-center justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }>
      <Loading type='area' />
    </div>
  }
  if (systemFeatures.license?.status === LicenseStatus.LOST) {
    return <div className='mx-auto mt-8 w-full'>
      <div className='bg-white'>
        <div className="from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 rounded-lg bg-gradient-to-r p-4">
          <div className='bg-components-card-bg shadows-shadow-lg relative mb-2 flex h-10 w-10 items-center justify-center rounded-xl shadow'>
            <RiContractLine className='h-5 w-5' />
            <RiErrorWarningFill className='text-text-warning-secondary absolute -right-1 -top-1 h-4 w-4' />
          </div>
          <p className='system-sm-medium text-text-primary'>{t('login.licenseLost')}</p>
          <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.licenseLostTip')}</p>
        </div>
      </div>
    </div>
  }
  if (systemFeatures.license?.status === LicenseStatus.EXPIRED) {
    return <div className='mx-auto mt-8 w-full'>
      <div className='bg-white'>
        <div className="from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 rounded-lg bg-gradient-to-r p-4">
          <div className='bg-components-card-bg shadows-shadow-lg relative mb-2 flex h-10 w-10 items-center justify-center rounded-xl shadow'>
            <RiContractLine className='h-5 w-5' />
            <RiErrorWarningFill className='text-text-warning-secondary absolute -right-1 -top-1 h-4 w-4' />
          </div>
          <p className='system-sm-medium text-text-primary'>{t('login.licenseExpired')}</p>
          <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.licenseExpiredTip')}</p>
        </div>
      </div>
    </div>
  }
  if (systemFeatures.license?.status === LicenseStatus.INACTIVE) {
    return <div className='mx-auto mt-8 w-full'>
      <div className='bg-white'>
        <div className="from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 rounded-lg bg-gradient-to-r p-4">
          <div className='bg-components-card-bg shadows-shadow-lg relative mb-2 flex h-10 w-10 items-center justify-center rounded-xl shadow'>
            <RiContractLine className='h-5 w-5' />
            <RiErrorWarningFill className='text-text-warning-secondary absolute -right-1 -top-1 h-4 w-4' />
          </div>
          <p className='system-sm-medium text-text-primary'>{t('login.licenseInactive')}</p>
          <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.licenseInactiveTip')}</p>
        </div>
      </div>
    </div>
  }

  return (
    <>
      <div className="mx-auto mt-8 w-full">
        {isInviteLink
          ? <div className="mx-auto w-full">
            <h2 className="title-4xl-semi-bold text-text-primary">{t('login.join')}{workspaceName}</h2>
            <p className='body-md-regular text-text-tertiary mt-2'>{t('login.joinTipStart')}{workspaceName}{t('login.joinTipEnd')}</p>
          </div>
          : <div className="mx-auto w-full">
            <h2 className="title-4xl-semi-bold text-text-primary">{t('login.pageTitle')}</h2>
            <p className='body-md-regular text-text-tertiary mt-2'>{t('login.welcome')}</p>
          </div>}
        <div className="bg-white">
          <div className="mt-6 flex flex-col gap-3">
            {systemFeatures.enable_social_oauth_login && <SocialAuth />}
            {systemFeatures.sso_enforced_for_signin && <div className='w-full'>
              <SSOAuth protocol={systemFeatures.sso_enforced_for_signin_protocol} />
            </div>}
          </div>

          {showORLine && <div className="relative mt-6">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className='from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent h-px w-full bg-gradient-to-r'></div>
            </div>
            <div className="relative flex justify-center">
              <span className="text-text-tertiary system-xs-medium-uppercase bg-white px-2">{t('login.or')}</span>
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
                <MailAndPasswordAuth isInvite={isInviteLink} isEmailSetup={systemFeatures.is_email_setup} allowRegistration={systemFeatures.is_allow_register} />
                {systemFeatures.enable_email_code_login && <div className='cursor-pointer py-1 text-center' onClick={() => { updateAuthType('code') }}>
                  <span className='system-xs-medium text-components-button-secondary-accent-text'>{t('login.useVerificationCode')}</span>
                </div>}
              </>}
            </>
          }
          {allMethodsAreDisabled && <>
            <div className="from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 rounded-lg bg-gradient-to-r p-4">
              <div className='bg-components-card-bg shadows-shadow-lg mb-2 flex h-10 w-10 items-center justify-center rounded-xl shadow'>
                <RiDoorLockLine className='h-5 w-5' />
              </div>
              <p className='system-sm-medium text-text-primary'>{t('login.noLoginMethod')}</p>
              <p className='system-xs-regular text-text-tertiary mt-1'>{t('login.noLoginMethodTip')}</p>
            </div>
            <div className="relative my-2 py-2">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className='from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent h-px w-full bg-gradient-to-r'></div>
              </div>
            </div>
          </>}
          <div className="system-xs-regular text-text-tertiary mt-2 block w-full">
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
          {IS_CE_EDITION && <div className="w-hull system-xs-regular text-text-tertiary mt-2 block">
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
