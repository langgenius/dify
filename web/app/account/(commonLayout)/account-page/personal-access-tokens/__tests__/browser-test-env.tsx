import type { PersonalAccessTokenResponse } from '@dify/contracts/api/console/account/types.gen'
import type { ReactElement } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import accountSettings from '@/i18n/locales/en-US/account-settings.json'
import common from '@/i18n/locales/en-US/common.json'
import dataset from '@/i18n/locales/en-US/dataset.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'

/** Real translations keep scope counts and accessible control names in the feature journey. */
export async function renderWithTokenMessages(ui: ReactElement) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { accountSettings, common, dataset, navigation } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

export const token: PersonalAccessTokenResponse = {
  id: '019a0000-0000-7000-8000-000000000001',
  name: 'release-pipeline',
  secret_last_four: '7f21',
  created_at: '2026-10-15T00:00:00Z',
  expires_at: null,
  last_used_at: null,
  resource_scope_mode: 'selected',
  workspace_scope_mode: 'selected',
  resource_count: 3,
  workspace_count: 2,
  unavailable_count: 1,
  status: 'access_issue',
  version: 1,
}

export const tokenList = (tokens: PersonalAccessTokenResponse[] = []) => ({
  data: tokens,
  page: 1,
  limit: 20,
  total: tokens.length,
  has_more: false,
})

export async function renderTokenPage() {
  const queryClient = createTestQueryClient()
  seedSystemFeatures(queryClient)
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const screen = await renderWithTokenMessages(
    <QueryClientTestProvider queryClient={queryClient}>
      <UrlState>
        <PersonalAccessTokens />
      </UrlState>
    </QueryClientTestProvider>,
  )
  return { screen, queryClient }
}
