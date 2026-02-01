'use client'
import { RiContractLine, RiDoorLockLine, RiErrorWarningFill } from '@remixicon/react'
import Link from 'next/link'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { IS_CE_EDITION } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { LicenseStatus } from '@/types/feature'
import { cn } from '@/utils/classnames'
import MailAndCodeAuth from './components/mail-and-code-auth'
import MailAndPasswordAuth from './components/mail-and-password-auth'
import SSOAuth from './components/sso-auth'

const NormalForm = () => {
  const { t } = useTranslation()

  const [isLoading, setIsLoading] = useState(true)
  const { systemFeatures } = useGlobalPublicStore()
  const [authType, updateAuthType] = useState<'code' | 'password'>('password')
  const [showORLine, setShowORLine] = useState(false)
  const [allMethodsAreDisabled, setAllMethodsAreDisabled] = useState(false)

  const init = useCallback(async () => {
    try {
      setAllMethodsAreDisabled(!systemFeatures.enable_social_oauth_login && !systemFeatures.enable_email_code_login && !systemFeatures.enable_email_password_login && !systemFeatures.sso_enforced_for_signin)
      setShowORLine((systemFeatures.enable_social_oauth_login || systemFeatures.sso_enforced_for_signin) && (systemFeatures.enable_email_code_login || systemFeatures.enable_email_password_login))
      updateAuthType(systemFeatures.enable_email_password_login ? 'password' : 'code')
    }
    catch (error) {
      console.error(error)
      setAllMethodsAreDisabled(true)
    }
    finally { setIsLoading(false) }
  }, [systemFeatures])
  useEffect(() => {
    init()
  }, [init])
  if (isLoading) {
    return (
      <div className={
        cn(
          'flex w-full grow flex-col items-center justify-center',
          'px-6',
          'md:px-[108px]',
        )
      }
      >
        <Loading type="area" />
      </div>
    )
  }
  if (systemFeatures.license?.status === LicenseStatus.LOST) {
    return (
      <div className="mx-auto mt-8 w-full">
        <div className="relative">
          <div className="rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
            <div className="shadows-shadow-lg relative mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
              <RiContractLine className="h-5 w-5" />
              <RiErrorWarningFill className="absolute -right-1 -top-1 h-4 w-4 text-text-warning-secondary" />
            </div>
            <p className="system-sm-medium text-text-primary">{t('licenseLost', { ns: 'login' })}</p>
            <p className="system-xs-regular mt-1 text-text-tertiary">{t('licenseLostTip', { ns: 'login' })}</p>
          </div>
        </div>
      </div>
    )
  }
  if (systemFeatures.license?.status === LicenseStatus.EXPIRED) {
    return (
      <div className="mx-auto mt-8 w-full">
        <div className="relative">
          <div className="rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
            <div className="shadows-shadow-lg relative mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
              <RiContractLine className="h-5 w-5" />
              <RiErrorWarningFill className="absolute -right-1 -top-1 h-4 w-4 text-text-warning-secondary" />
            </div>
            <p className="system-sm-medium text-text-primary">{t('licenseExpired', { ns: 'login' })}</p>
            <p className="system-xs-regular mt-1 text-text-tertiary">{t('licenseExpiredTip', { ns: 'login' })}</p>
          </div>
        </div>
      </div>
    )
  }
  if (systemFeatures.license?.status === LicenseStatus.INACTIVE) {
    return (
      <div className="mx-auto mt-8 w-full">
        <div className="relative">
          <div className="rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
            <div className="shadows-shadow-lg relative mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
              <RiContractLine className="h-5 w-5" />
              <RiErrorWarningFill className="absolute -right-1 -top-1 h-4 w-4 text-text-warning-secondary" />
            </div>
            <p className="system-sm-medium text-text-primary">{t('licenseInactive', { ns: 'login' })}</p>
            <p className="system-xs-regular mt-1 text-text-tertiary">{t('licenseInactiveTip', { ns: 'login' })}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mx-auto mt-8 w-full">
        <div className="mx-auto w-full">
          <h2 className="title-4xl-semi-bold text-text-primary">{systemFeatures.branding.enabled ? t('pageTitleForE', { ns: 'login' }) : t('pageTitle', { ns: 'login' })}</h2>
          <p className="body-md-regular mt-2 text-text-tertiary">{t('welcome', { ns: 'login' })}</p>
        </div>
        <div className="relative">
          <div className="mt-6 flex flex-col gap-3">
            {systemFeatures.sso_enforced_for_signin && (
              <div className="w-full">
                <SSOAuth protocol={systemFeatures.sso_enforced_for_signin_protocol} />
              </div>
            )}
          </div>

          {showORLine && (
            <div className="relative mt-6">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="h-px w-full bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="system-xs-medium-uppercase px-2 text-text-tertiary">{t('or', { ns: 'login' })}</span>
              </div>
            </div>
          )}
          {
            (systemFeatures.enable_email_code_login || systemFeatures.enable_email_password_login) && (
              <>
                {systemFeatures.enable_email_code_login && authType === 'code' && (
                  <>
                    <MailAndCodeAuth />
                    {systemFeatures.enable_email_password_login && (
                      <div className="cursor-pointer py-1 text-center" onClick={() => { updateAuthType('password') }}>
                        <span className="system-xs-medium text-components-button-secondary-accent-text">{t('usePassword', { ns: 'login' })}</span>
                      </div>
                    )}
                  </>
                )}
                {systemFeatures.enable_email_password_login && authType === 'password' && (
                  <>
                    <MailAndPasswordAuth isEmailSetup={systemFeatures.is_email_setup} />
                    {systemFeatures.enable_email_code_login && (
                      <div className="cursor-pointer py-1 text-center" onClick={() => { updateAuthType('code') }}>
                        <span className="system-xs-medium text-components-button-secondary-accent-text">{t('useVerificationCode', { ns: 'login' })}</span>
                      </div>
                    )}
                  </>
                )}
              </>
            )
          }
          {allMethodsAreDisabled && (
            <>
              <div className="rounded-lg bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
                <div className="shadows-shadow-lg mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
                  <RiDoorLockLine className="h-5 w-5" />
                </div>
                <p className="system-sm-medium text-text-primary">{t('noLoginMethod', { ns: 'login' })}</p>
                <p className="system-xs-regular mt-1 text-text-tertiary">{t('noLoginMethodTip', { ns: 'login' })}</p>
              </div>
              <div className="relative my-2 py-2">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="h-px w-full bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
                </div>
              </div>
            </>
          )}
          {!systemFeatures.branding.enabled && (
            <>
              <div className="system-xs-regular mt-2 block w-full text-text-tertiary">
                {t('tosDesc', { ns: 'login' })}
              &nbsp;
                <Link
                  className="system-xs-medium text-text-secondary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://dify.ai/terms"
                >
                  {t('tos', { ns: 'login' })}
                </Link>
              &nbsp;&&nbsp;
                <Link
                  className="system-xs-medium text-text-secondary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://dify.ai/privacy"
                >
                  {t('pp', { ns: 'login' })}
                </Link>
              </div>
              {IS_CE_EDITION && (
                <div className="w-hull system-xs-regular mt-2 block text-text-tertiary">
                  {t('goToInit', { ns: 'login' })}
              &nbsp;
                  <Link
                    className="system-xs-medium text-text-secondary hover:underline"
                    href="/install"
                  >
                    {t('setAdminAccount', { ns: 'login' })}
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
