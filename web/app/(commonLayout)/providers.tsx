import type { ReactNode } from 'react'
import { TriggerEventsLimitPrompt } from '@/app/components/billing/trigger-events-limit-modal/prompt'
import { ModelCredentialDialog } from '@/app/components/header/account-setting/model-provider-page/model-modal/dialog'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ExternalServiceSync } from './external-service-sync'
import { CommonLayoutHydrationBoundary } from './hydration-boundary'

export async function ConsoleRuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <>
      <OAuthRegistrationAnalytics />
      <CommonLayoutHydrationBoundary>
        <ExternalServiceSync />
        {children}
      </CommonLayoutHydrationBoundary>
    </>
  )
}

export function ConsoleContextProviders({ children }: { children: ReactNode }) {
  return (
    <EventEmitterContextProvider>
      {children}
      <ModelCredentialDialog />
      <TriggerEventsLimitPrompt />
    </EventEmitterContextProvider>
  )
}
