'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { RiContractLine, RiDoorLockLine, RiErrorWarningFill } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { IS_CE_EDITION } from '@/config'
import { systemFeaturesPlaceholder, systemFeaturesQueryOptions } from '@/features/system-features/client'
import { LicenseStatus } from '@/features/system-features/constants'
import Link from '@/next/link'
import MailAndCodeAuth from './components/mail-and-code-auth'
import MailAndPasswordAuth from './components/mail-and-password-auth'
import SSOAuth from './components/sso-auth'

type AuthType = 'code' | 'password'

const NormalForm = () => {
  const { t } = useTranslation()

  const { data: systemFeatures = systemFeaturesPlaceholder, isPlaceholderData: isSystemFeaturesPlaceholder } = useQuery(systemFeaturesQueryOptions())
  const [selectedAuthType, setSelectedAuthType] = useState<AuthType | null>(null)

  const hasSsoLogin = Boolean(systemFeatures.sso_enforced_for_signin)
  const hasEmailCodeLogin = systemFeatures.enable_email_code_login
  const hasEmailPasswordLogin = systemFeatures.enable_email_password_login
  const hasEmailLogin = hasEmailCodeLogin || hasEmailPasswordLogin
  const defaultAuthType: AuthType = hasEmailPasswordLogin ? 'password' : 'code'
  const authType = selectedAuthType === 'password' && hasEmailPasswordLogin
    ? 'password'
    : selectedAuthType === 'code' && hasEmailCodeLogin
      ? 'code'
      : defaultAuthType
  const showORLine = hasSsoLogin && hasEmailLogin
  const allMethodsAreDisabled = !hasEmailCodeLogin && !hasEmailPasswordLogin && !hasSsoLogin

  if (isSystemFeaturesPlaceholder) {
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
          <div className="rounded-lg bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
            <div className="shadows-shadow-lg relative mb-2 flex size-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
              <RiContractLine className="size-5" />
              <RiErrorWarningFill className="absolute -top-1 -right-1 size-4 text-text-warning-secondary" />
            </div>
            <p className="system-sm-medium text-text-primary">{t('licenseLost', { ns: 'login' })}</p>
            <p className="mt-1 system-xs-regular text-text-tertiary">{t('licenseLostTip', { ns: 'login' })}</p>
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
            <p className="system-sm-medium text-text-primary">{t('licenseExpired', { ns: 'login' })}</p>
            <p className="mt-1 system-xs-regular text-text-tertiary">{t('licenseExpiredTip', { ns: 'login' })}</p>
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
            <p className="system-sm-medium text-text-primary">{t('licenseInactive', { ns: 'login' })}</p>
            <p className="mt-1 system-xs-regular text-text-tertiary">{t('licenseInactiveTip', { ns: 'login' })}</p>
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
          <p className="mt-2 body-md-regular text-text-tertiary">{t('welcome', { ns: 'login' })}</p>
        </div>
        <div className="relative">
          <div className="mt-6 flex flex-col gap-3">
            {hasSsoLogin && (
              <div className="w-full">
                <SSOAuth protocol={systemFeatures.sso_enforced_for_signin_protocol} />
              </div>
            )}
          </div>

          {showORLine && (
            <div className="relative mt-6">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="h-px w-full bg-linear-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="px-2 system-xs-medium-uppercase text-text-tertiary">{t('or', { ns: 'login' })}</span>
              </div>
            </div>
          )}
          {
            hasEmailLogin && (
              <>
                {hasEmailCodeLogin && authType === 'code' && (
                  <>
                    <MailAndCodeAuth />
                    {hasEmailPasswordLogin && (
                      <div className="cursor-pointer py-1 text-center" onClick={() => { setSelectedAuthType('password') }}>
                        <span className="system-xs-medium text-components-button-secondary-accent-text">{t('usePassword', { ns: 'login' })}</span>
                      </div>
                    )}
                  </>
                )}
                {hasEmailPasswordLogin && authType === 'password' && (
                  <>
                    <MailAndPasswordAuth isEmailSetup={systemFeatures.is_email_setup} />
                    {hasEmailCodeLogin && (
                      <div className="cursor-pointer py-1 text-center" onClick={() => { setSelectedAuthType('code') }}>
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
              <div className="rounded-lg bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4">
                <div className="shadows-shadow-lg mb-2 flex size-10 items-center justify-center rounded-xl bg-components-card-bg shadow">
                  <RiDoorLockLine className="size-5" />
                </div>
                <p className="system-sm-medium text-text-primary">{t('noLoginMethod', { ns: 'login' })}</p>
                <p className="mt-1 system-xs-regular text-text-tertiary">{t('noLoginMethodTip', { ns: 'login' })}</p>
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
                <div className="w-hull mt-2 block system-xs-regular text-text-tertiary">
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
