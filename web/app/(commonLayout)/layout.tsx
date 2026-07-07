import type { ReactNode } from 'react'
import * as React from 'react'
import InSiteMessageNotification from '@/app/components/app/in-site-message/notification'
import AmplitudeProvider from '@/app/components/base/amplitude'
import { GoogleAnalyticsScripts } from '@/app/components/base/ga'
import Zendesk from '@/app/components/base/zendesk'
import { EducationVerifyActionRecorder } from '@/app/components/education-verify-action-recorder'
import { GotoAnything } from '@/app/components/goto-anything'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import MainNavLayout from '@/app/components/main-nav/layout'
import { NextRouteStateBridge } from '@/app/components/next-route-state'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'
import ReadmePanel from '@/app/components/plugins/readme-panel'
import WorkflowGeneratorMount from '@/app/components/workflow/workflow-generator/mount'
import { AppContextProvider } from '@/context/app-context-provider'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import PartnerStack from '../components/billing/partner-stack'
import { CommonLayoutHydrationBoundary } from './hydration-boundary'
import { RoleRouteGuard } from './role-route-guard'

export default async function Layout({ children }: { children: ReactNode }) {
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
            <AppContextProvider>
              <EventEmitterContextProvider>
                <ProviderContextProvider>
                  <ModalContextProvider>
                    <MainNavLayout>
                      <RoleRouteGuard>
                        {children}
                      </RoleRouteGuard>
                    </MainNavLayout>
                    <InSiteMessageNotification />
                    <PartnerStack />
                    <ReadmePanel />
                    <GotoAnything />
                    <WorkflowGeneratorMount />
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
