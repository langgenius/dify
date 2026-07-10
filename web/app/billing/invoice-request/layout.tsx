import * as React from 'react'
import { CommonLayoutHydrationBoundary } from '@/app/(commonLayout)/hydration-boundary'
import AmplitudeProvider from '@/app/components/base/amplitude'
import { GoogleAnalyticsScripts } from '@/app/components/base/ga'
import Zendesk from '@/app/components/base/zendesk'
import { EducationVerifyActionRecorder } from '@/app/components/education-verify-action-recorder'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import { NextRouteStateBridge } from '@/app/components/next-route-state'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'
import { AppContextProvider } from '@/context/app-context-provider'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { ProviderContextProvider } from '@/context/provider-context-provider'

export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <React.Fragment>
      <GoogleAnalyticsScripts />
      <AmplitudeProvider />
      <OAuthRegistrationAnalytics />
      <EducationVerifyActionRecorder />
      <CommonLayoutHydrationBoundary>
        <NextRouteStateBridge>
          <div className="min-h-full bg-background-default">
            <MaintenanceNotice />
            <AppContextProvider>
              <EventEmitterContextProvider>
                <ProviderContextProvider>
                  <ModalContextProvider>
                    {children}
                  </ModalContextProvider>
                </ProviderContextProvider>
              </EventEmitterContextProvider>
            </AppContextProvider>
          </div>
        </NextRouteStateBridge>
      </CommonLayoutHydrationBoundary>
      <Zendesk />
    </React.Fragment>
  )
}
