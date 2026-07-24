import type { ReactNode } from 'react'
import { EducationVerifyActionRecorder } from '@/app/components/education-verify-action-recorder'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import { ExternalServiceSync } from './external-service-sync'
import { CommonLayoutHydrationBoundary } from './hydration-boundary'
import { ProfileBootstrapGate } from './profile-bootstrap-gate'

export async function ConsoleRuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <>
      <OAuthRegistrationAnalytics />
      <EducationVerifyActionRecorder />
      <CommonLayoutHydrationBoundary>
        <ProfileBootstrapGate>
          <ExternalServiceSync />
          {children}
        </ProfileBootstrapGate>
      </CommonLayoutHydrationBoundary>
    </>
  )
}

export function ConsoleContextProviders({ children }: { children: ReactNode }) {
  return (
    <EventEmitterContextProvider>
      <ProviderContextProvider>
        <ModalContextProvider>{children}</ModalContextProvider>
      </ProviderContextProvider>
    </EventEmitterContextProvider>
  )
}
