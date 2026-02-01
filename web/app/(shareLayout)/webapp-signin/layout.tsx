'use client'

import type { PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useSystemFeatures } from '@/hooks/use-global-public'
import { cn } from '@/utils/classnames'

export default function SignInLayout({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const systemFeatures = useSystemFeatures()
  useDocumentTitle(t('webapp.login', { ns: 'login' }))
  return (
    <>
      <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
        <div className={cn('flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle')}>
          {/* <Header /> */}
          <div className={cn('flex w-full grow flex-col items-center justify-center px-6 md:px-[108px]')}>
            <div className="flex justify-center md:w-[440px] lg:w-[600px]">
              {children}
            </div>
          </div>
          {systemFeatures.branding.enabled === false && (
            <div className="system-xs-regular px-8 py-6 text-text-tertiary">
              ©
              {' '}
              {new Date().getFullYear()}
              {' '}
              LangGenius, Inc. All rights reserved.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
