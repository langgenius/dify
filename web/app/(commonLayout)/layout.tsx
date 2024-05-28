import React from 'react'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import SwrInitor from '@/app/components/swr-initor'
import { AppContextProvider } from '@/context/app-context'
import GA, { GaType } from '@/app/components/base/ga'
import HeaderWrapper from '@/app/components/header/HeaderWrapper'
import Header from '@/app/components/header'
import { EventEmitterContextProvider } from '@/context/event-emitter'
import { ProviderContextProvider } from '@/context/provider-context'
import { ModalContextProvider } from '@/context/modal-context'

const Layout = ({ children }: { children: ReactNode }) => {
  const cookieStore = cookies()
  // TODO:测试环境的cookie名字和生产环境cookie名字都需要加
  const token = cookieStore.get('__Secure-next-auth.session-token')
  // const token = cookieStore.get('next-auth.session-token')

  return (
    <>
      <GA gaType={GaType.admin} />
      <SwrInitor token={token?.value}>
        <AppContextProvider>
          <EventEmitterContextProvider>
            <ProviderContextProvider>
              <ModalContextProvider>
                <HeaderWrapper>
                  <Header />
                </HeaderWrapper>
                {children}
              </ModalContextProvider>
            </ProviderContextProvider>
          </EventEmitterContextProvider>
        </AppContextProvider>
      </SwrInitor>
    </>
  )
}

export const metadata = {
  title: 'Dify',
}

export default Layout
