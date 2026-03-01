import type { ReactNode } from 'react'
import * as React from 'react'
import { AppInitializer } from '@/app/components/app-initializer'
import AmplitudeProvider from '@/app/components/base/amplitude'
import GA, { GaType } from '@/app/components/base/ga'
import HeaderWrapper from '@/app/components/header/header-wrapper'
import { AppContextProvider } from '@/context/app-context'
import { EventEmitterContextProvider } from '@/context/event-emitter'
import { ModalContextProvider } from '@/context/modal-context'
import { ProviderContextProvider } from '@/context/provider-context'
import Header from './header'

const Layout = ({ children }: { children: ReactNode }) => {
  return (
    <>
      <GA gaType={GaType.admin} />
      <AmplitudeProvider />
      <AppInitializer>
        <AppContextProvider>
          <EventEmitterContextProvider>
            <ProviderContextProvider>
              <ModalContextProvider>
                <HeaderWrapper>
                  <Header />
                </HeaderWrapper>
                <div className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-components-panel-bg">
                  {children}
                </div>
              </ModalContextProvider>
            </ProviderContextProvider>
          </EventEmitterContextProvider>
        </AppContextProvider>
      </AppInitializer>
    </>
  )
}
export default Layout
