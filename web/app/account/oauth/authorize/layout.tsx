'use client'
import { cn } from '@langgenius/dify-ui/cn'

import Loading from '@/app/components/base/loading'
import Header from '@/app/signin/_header'
import { AppContextProvider } from '@/context/app-context-provider'
import { useGlobalPublicStore } from '@/context/global-public-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { useIsLogin } from '@/service/use-common'

export default function SignInLayout({ children }: any) {
  const { systemFeatures } = useGlobalPublicStore()
  useDocumentTitle('')
  const { isLoading, data: loginData } = useIsLogin()
  const isLoggedIn = loginData?.logged_in

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full justify-center bg-background-default-burn">
        <Loading />
      </div>
    )
  }
  return (
    <>
      <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
        <div className={cn('flex w-full shrink-0 flex-col items-center rounded-2xl border border-effects-highlight bg-background-default-subtle')}>
          <Header />
          <div className={cn('flex w-full grow flex-col items-center justify-center px-6 md:px-[108px]')}>
            <div className="flex flex-col md:w-[400px]">
              {isLoggedIn
                ? (
                    <AppContextProvider>
                      {children}
                    </AppContextProvider>
                  )
                : children}
            </div>
          </div>
          {systemFeatures.branding.enabled === false && (
            <div className="px-8 py-6 system-xs-regular text-text-tertiary">
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
