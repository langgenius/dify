'use client'
import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import Header from '@/app/signin/_header'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

const copyrightYear = new Date().getFullYear()

// The same shell as the OAuth consent page (`/account/oauth/authorize`).
export default function KnowledgeAgentAuthorizeLayout({ children }: { children: ReactNode }) {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return (
    <div className="flex min-h-screen w-full justify-center bg-background-default-burn p-3 sm:p-6">
      <div className="flex w-full shrink-0 flex-col items-center rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <Header />
        <main className="flex w-full grow flex-col items-center justify-center px-4 py-6 md:px-27">
          <div className="flex w-full flex-col md:w-110">{children}</div>
        </main>
        {systemFeatures.branding.enabled === false && (
          <div className="px-8 py-6 system-xs-regular text-text-tertiary">
            © {copyrightYear} LangGenius, Inc. All rights reserved.
          </div>
        )}
      </div>
    </div>
  )
}
