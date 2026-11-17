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
    <div className="flex min-h-dvh w-full justify-center bg-background-default-subtle sm:bg-background-default-burn sm:p-6">
      <div className="flex w-full min-w-0 flex-col items-center bg-background-default-subtle sm:rounded-2xl sm:border sm:border-effects-highlight">
        {header && <Header />}
        <main className="flex w-full grow flex-col items-center justify-center px-4 sm:px-6 md:px-27">
          <div
            className={
              wide
                ? 'flex w-full justify-center md:w-110 lg:w-150'
                : 'flex w-full flex-col md:w-100'
            }
          >
            {children}
          </div>
        </main>
        {!systemFeatures.branding.enabled && (
          <footer className="px-4 py-6 system-xs-regular text-text-tertiary sm:px-8">
            © {copyrightYear} LangGenius, Inc. All rights reserved.
          </footer>
        )}
      </div>
    </div>
  )
}
