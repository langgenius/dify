import type { ReactNode } from 'react'
import * as React from 'react'
import InSiteMessageNotification from '@/app/components/app/in-site-message/notification'
import AmplitudeProvider from '@/app/components/base/amplitude'
import { GoogleAnalyticsScripts } from '@/app/components/base/ga'
import Zendesk from '@/app/components/base/zendesk'
import { EducationVerifyActionRecorder } from '@/app/components/education-verify-action-recorder'
import { GotoAnything } from '@/app/components/goto-anything'
import Header from '@/app/components/header'
import HeaderWrapper from '@/app/components/header/header-wrapper'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'
import ReadmePanel from '@/app/components/plugins/readme-panel'
import { AppContextProviderClientOnly } from '@/context/app-context-provider-client-only'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import PartnerStack from '../components/billing/partner-stack'
import RoleRouteGuard from './role-route-guard'

const Layout = ({ children }: { children: ReactNode }) => {
  return (
    <>
      <GoogleAnalyticsScripts />
      <AmplitudeProvider />
      <OAuthRegistrationAnalytics />
      <EducationVerifyActionRecorder />
      <AppContextProviderClientOnly>
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
      </AppContextProviderClientOnly>
      <Zendesk />
    </>
  )
}
export default Layout
