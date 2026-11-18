import type { ReactElement } from 'react'
import type { Features } from '@/app/components/base/features/types'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { ModelCredentialDialog } from '@/app/components/header/account-setting/model-provider-page/model-modal/dialog'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'

export function renderWithConfigurationModals(
  ui: ReactElement,
  { initialFeatures, ...options }: ConsoleQueryTestOptions & { initialFeatures?: Features } = {},
) {
  const featuresStore = createFeaturesStore(
    initialFeatures ? { features: initialFeatures } : undefined,
  )
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const view = renderWithConsoleQuery(
    <UrlState>
      <EventEmitterContextProvider>
        <FeaturesContext value={featuresStore}>
          <>
            {ui}
            <ModelCredentialDialog />
          </>
        </FeaturesContext>
      </EventEmitterContextProvider>
    </UrlState>,
    options,
  )
  return { ...view, featuresStore }
}
