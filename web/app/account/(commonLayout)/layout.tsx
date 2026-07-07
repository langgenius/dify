import * as React from 'react'
import { CommonLayoutHydrationBoundary } from '@/app/(commonLayout)/hydration-boundary'
import AmplitudeProvider from '@/app/components/base/amplitude'
import { GoogleAnalyticsScripts } from '@/app/components/base/ga'
import { EducationVerifyActionRecorder } from '@/app/components/education-verify-action-recorder'
import HeaderWrapper from '@/app/components/header/header-wrapper'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'
import { AppContextProvider } from '@/context/app-context-provider'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import Header from './header'

export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <React.Fragment>
      <GoogleAnalyticsScripts />
      <AmplitudeProvider />
      <OAuthRegistrationAnalytics />
      <EducationVerifyActionRecorder />
      <CommonLayoutHydrationBoundary>
        <div className="flex h-full flex-col overflow-hidden bg-background-body">
          <MaintenanceNotice />
          <AppContextProvider>
            <EventEmitterContextProvider>
              <ProviderContextProvider>
                <ModalContextProvider>
                  <HeaderWrapper>
                    <Header />
                  </HeaderWrapper>
                  <div className="relative flex h-0 min-h-0 shrink-0 grow flex-col overflow-y-auto bg-components-panel-bg">
                    {children}
                  </div>
                </ModalContextProvider>
              </ProviderContextProvider>
            </EventEmitterContextProvider>
          </AppContextProvider>
        </div>
      </CommonLayoutHydrationBoundary>
    </React.Fragment>
  )
}
