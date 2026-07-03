import type { ReactNode } from 'react'
import * as React from 'react'
import { CommonLayoutHydrationBoundary } from '@/app/(commonLayout)/hydration-boundary'
import AmplitudeProvider from '@/app/components/base/amplitude'
import { GoogleAnalyticsScripts } from '@/app/components/base/ga'
import { EducationVerifyActionRecorder } from '@/app/components/education-verify-action-recorder'
import HeaderWrapper from '@/app/components/header/header-wrapper'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'
import { AppContextProvider } from '@/context/app-context-provider'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import Header from './header'

const Layout = async ({ children }: { children: ReactNode }) => {
  return (
    <>
      <GoogleAnalyticsScripts />
      <AmplitudeProvider />
      <OAuthRegistrationAnalytics />
      <EducationVerifyActionRecorder />
      <CommonLayoutHydrationBoundary>
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
      </CommonLayoutHydrationBoundary>
    </>
  )
}
export default Layout
