import React from 'react'
import type { ReactNode } from 'react'
import SwrInitializer from '@/app/components/swr-initializer'
import { AppContextProvider } from '@/context/app-context'
import GA, { GaType } from '@/app/components/base/ga'
import HeaderWrapper from '@/app/components/header/header-wrapper'
import Header from '@/app/components/header'
import { EventEmitterContextProvider } from '@/context/event-emitter'
import { ProviderContextProvider } from '@/context/provider-context'
import { ModalContextProvider } from '@/context/modal-context'
import GotoAnything from '@/app/components/goto-anything'
import Zendesk from '@/app/components/base/zendesk'
import Splash from '../components/splash'

const Layout = ({ children }: { children: ReactNode }) => {
  return (
    <Splash>
      <>
        <GA gaType={GaType.admin} />
        <SwrInitializer>
          <AppContextProvider>
            <EventEmitterContextProvider>
              <ProviderContextProvider>
                <ModalContextProvider>
                  <HeaderWrapper>
                    <Header />
                  </HeaderWrapper>
                  {children}
                  <GotoAnything />
                </ModalContextProvider>
              </ProviderContextProvider>
            </EventEmitterContextProvider>
          </AppContextProvider>
          <Zendesk />
        </SwrInitializer>
      </>
    </Splash>
  )
}
export default Layout
