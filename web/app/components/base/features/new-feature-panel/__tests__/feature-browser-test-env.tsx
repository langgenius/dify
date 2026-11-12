import type { ReactElement } from 'react'
import type { Features } from '../../types'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import i18next from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import appAnnotation from '@/i18n/locales/en-US/app-annotation.json'
import appApi from '@/i18n/locales/en-US/app-api.json'
import appDebug from '@/i18n/locales/en-US/app-debug.json'
import billing from '@/i18n/locales/en-US/billing.json'
import common from '@/i18n/locales/en-US/common.json'
import fileUpload from '@/i18n/locales/en-US/file-upload.json'
import modelProvider from '@/i18n/locales/en-US/model-provider.json'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createTestQueryClient } from '@/test/query-client'
import { TransferMethod } from '@/types/app'
import { FeaturesContext } from '../../context'
import { createFeaturesStore } from '../../store'

export const savedFile = {
  enabled: true,
  allowed_file_upload_methods: [TransferMethod.local_file],
  allowed_file_types: ['image'],
  allowed_file_extensions: ['.jpg'],
  number_limits: 5,
}

export async function renderFeature(
  ui: ReactElement,
  features: Partial<Features> = {},
  options: ConsoleQueryTestOptions = {},
) {
  const queryClient = options.queryClient ?? createTestQueryClient()
  const { wrapper: QueryProvider } = createConsoleQueryWrapper({ ...options, queryClient })
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  const defaults = createFeaturesStore().getState().features
  const store = createFeaturesStore({ features: { ...defaults, ...features } })
  await i18next.init({
    lng: 'en-US',
    resources: {
      'en-US': { appAnnotation, appApi, appDebug, billing, common, fileUpload, modelProvider },
    },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const view = (content: ReactElement) => (
    <QueryProvider>
      <NuqsTestingAdapter>
        <I18nextProvider i18n={i18next}>
          <FeaturesContext value={store}>
            <div style={{ width: 360, margin: '40px auto' }}>{content}</div>
          </FeaturesContext>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>
  )
  const screen = await render(view(ui))
  return {
    screen,
    store,
    queryClient,
    rerender: (next: ReactElement) => screen.rerender(view(next)),
  }
}
