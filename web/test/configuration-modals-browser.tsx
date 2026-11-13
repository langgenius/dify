import type { ReactNode } from 'react'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'

export function createConfigurationModalTestWrapper(options: ConsoleQueryTestOptions = {}) {
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper(options)
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const featuresStore = createFeaturesStore()
  function Providers({ children }: { children: ReactNode }) {
    return (
      <ConsoleProvider>
        <UrlState>
          <EventEmitterContextProvider>
            <FeaturesContext value={featuresStore}>
              <ModalContextProvider>{children}</ModalContextProvider>
            </FeaturesContext>
          </EventEmitterContextProvider>
        </UrlState>
      </ConsoleProvider>
    )
  }
  return { queryClient, featuresStore, wrapper: Providers }
}
