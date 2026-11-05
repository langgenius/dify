'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Header from './header'

type AuthShellProps = {
  children: ReactNode
  header?: boolean
  wide?: boolean
}

const copyrightYear = new Date().getFullYear()

export function AuthShell({ children, header = true, wide = false }: AuthShellProps) {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return (
    <div className="flex min-h-screen w-full justify-center bg-background-default-burn p-6">
      <div className="flex w-full min-w-0 flex-col items-center rounded-2xl border border-effects-highlight bg-background-default-subtle">
        {header && <Header />}
        <main className="flex w-full grow flex-col items-center justify-center px-6 md:px-27">
          <div
            className={
              wide ? 'flex justify-center md:w-110 lg:w-150' : 'flex w-full flex-col md:w-100'
            }
          >
            {children}
          </div>
        </main>
        {!systemFeatures.branding.enabled && (
          <footer className="px-8 py-6 system-xs-regular text-text-tertiary">
            © {copyrightYear} LangGenius, Inc. All rights reserved.
          </footer>
        )}
      </div>
    </div>
  )
}
