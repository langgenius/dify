import * as React from 'react'
import AmplitudeProvider from '@/app/components/base/amplitude'
import { GoogleAnalyticsScripts } from '@/app/components/base/ga'
import Zendesk from '@/app/components/base/zendesk'
import { EducationVerifyActionRecorder } from '@/app/components/education-verify-action-recorder'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import MainNavLayout from '@/app/components/main-nav/layout'
import { NextRouteStateBridge } from '@/app/components/next-route-state'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'
import { AppBootstrapEffects } from '@/context/app-bootstrap-effects'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import { CommonLayoutGlobalMounts } from './global-mounts'
import { CommonLayoutHydrationBoundary } from './hydration-boundary'

export default async function Layout({
  children,
  detailSidebar,
}: {
  children: React.ReactNode
  detailSidebar: React.ReactNode
}) {
  return (
    <React.Fragment>
      <GoogleAnalyticsScripts />
      <AmplitudeProvider />
      <OAuthRegistrationAnalytics />
      <EducationVerifyActionRecorder />
      <CommonLayoutHydrationBoundary>
        <NextRouteStateBridge>
          <div className="flex h-full flex-col overflow-hidden">
            <MaintenanceNotice />
            <AppBootstrapEffects />
            <EventEmitterContextProvider>
              <ProviderContextProvider>
                <ModalContextProvider>
                  <MainNavLayout detailSidebar={detailSidebar}>
                    {children}
                  </MainNavLayout>
                  <CommonLayoutGlobalMounts />
                </ModalContextProvider>
              </ProviderContextProvider>
            </EventEmitterContextProvider>
          </div>
        </NextRouteStateBridge>
      </CommonLayoutHydrationBoundary>
      <Zendesk />
    </React.Fragment>
  )
}
