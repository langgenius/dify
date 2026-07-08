'use client'
import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'

import Header from '@/app/signin/_header'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useDocumentTitle from '@/hooks/use-document-title'

type Props = {
  children: ReactNode
}

const copyrightYear = new Date().getFullYear()

export default function OAuthAuthorizeLayout({ children }: Props) {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  useDocumentTitle('')

  return (
    <div className="flex min-h-screen w-full justify-center bg-background-default-burn p-6">
      <div className="flex w-full shrink-0 flex-col items-center rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <Header />
        <div className="flex w-full grow flex-col items-center justify-center px-6 md:px-[108px]">
          <div className="flex flex-col md:w-[400px]">
            {children}
          </div>
        </div>
        {systemFeatures.branding.enabled === false && (
          <div className="px-8 py-6 system-xs-regular text-text-tertiary">
            ©
            {' '}
            {copyrightYear}
            {' '}
            LangGenius, Inc. All rights reserved.
          </div>
        )}
      </div>
    </div>
  )
}
