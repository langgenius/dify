import type {
  PersonalAccessTokenListResponse,
  PersonalAccessTokenResponse,
} from '@dify/contracts/api/console/account/types.gen'
import type { ReactElement } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import accountSettings from '@/i18n/locales/en-US/account-settings.json'
import common from '@/i18n/locales/en-US/common.json'
import dataset from '@/i18n/locales/en-US/dataset.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'

export async function render(ui: ReactElement) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { accountSettings, common, dataset, navigation } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  return renderBrowser(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

export const token: PersonalAccessTokenResponse = {
  id: '019a0000-0000-7000-8000-000000000001',
  name: 'Page two token',
  secret_last_four: '7f21',
  created_at: '2026-10-15T00:00:00Z',
  expires_at: null,
  last_used_at: null,
  resource_scope_mode: 'all',
  workspace_scope_mode: 'none',
  resource_count: 0,
  workspace_count: 0,
  unavailable_count: 0,
  status: 'active',
  version: 1,
}
export const firstPage: PersonalAccessTokenListResponse = {
  data: Array.from({ length: 20 }, (_, index) => ({
    ...token,
    id: `019a0000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`,
    name: `Token ${index + 1}`,
  })),
  page: 1,
  limit: 20,
  total: 21,
  has_more: true,
}

export async function renderTokens(searchParams = '') {
  const client = createTestQueryClient()
  seedSystemFeatures(client)
  await page.viewport(1100, 800)
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  const rendered = await render(
    <QueryClientTestProvider queryClient={client}>
      <UrlState>
        <div className="mx-auto w-full max-w-252 px-6 py-12">
          <PersonalAccessTokens />
        </div>
      </UrlState>
    </QueryClientTestProvider>,
  )
  return { ...rendered, onUrlUpdate }
}
