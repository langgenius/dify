import type { ReactNode } from 'react'
import * as React from 'react'
import InSiteMessageNotification from '@/app/components/app/in-site-message/notification'
import GA, { GaType } from '@/app/components/base/ga'
import Zendesk from '@/app/components/base/zendesk'
import { ConsoleRouteGuard } from '@/app/components/console-route-guard'
import { GotoAnything } from '@/app/components/goto-anything'
import Header from '@/app/components/header'
import HeaderWrapper from '@/app/components/header/header-wrapper'
import ReadmePanel from '@/app/components/plugins/readme-panel'
import { AppContextProvider } from '@/context/app-context-provider'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import PartnerStack from '../components/billing/partner-stack'
import RoleRouteGuard from './role-route-guard'

const Layout = ({ children }: { children: ReactNode }) => {
  return (
    <>
      <GA gaType={GaType.admin} />
      <ConsoleRouteGuard>
        <AppContextProvider>
          <EventEmitterContextProvider>
            <ProviderContextProvider>
              <ModalContextProvider>
                <HeaderWrapper>
                  <Header />
                </HeaderWrapper>
                <RoleRouteGuard>
                  {children}
                </RoleRouteGuard>
                <InSiteMessageNotification />
                <PartnerStack />
                <ReadmePanel />
                <GotoAnything />
              </ModalContextProvider>
            </ProviderContextProvider>
          </EventEmitterContextProvider>
        </AppContextProvider>
        <Zendesk />
      </ConsoleRouteGuard>
    </>
  )
}
export default Layout
