import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalRoster } from '../external-roster'

// boundary: use real translations and the fixture's I18nextProvider instead of the global translator double.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

it('clears the combined external filters in one URL update and restores search focus while preserving other parameters', async ({
  onTestFinished,
}) => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(1223, 772)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, app, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  onTestFinished(() => queryClient.clear())
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    hasMemory: true,
    searchParams:
      '?agent_type=external&external_keyword=vendor&external_status=disabled&external_connected_by_me=true&external_sort_by=earliest_created&keyword=keep-dify-search&filter=drafts&layout=grid',
  })
  await render(
    <QueryProvider>
      <UrlState>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen flex-col">
            <ExternalRoster />
          </div>
        </I18nextProvider>
      </UrlState>
    </QueryProvider>,
  )
  const search = page.getByRole('searchbox', { name: 'Search agents', exact: true })
  const connectedByMe = page.getByRole('checkbox', { name: 'Connected by me', exact: true })
  await expect.element(search).toHaveValue('vendor')
  await expect.element(page.getByRole('radio', { name: 'Disabled 1', exact: true })).toBeChecked()
  await expect.element(connectedByMe).toBeChecked()
  await expect
    .element(page.getByRole('status').getByText('No matching agents', { exact: true }))
    .toBeVisible()
  const clear = page.getByRole('button', { name: 'Clear filters', exact: true })
  await expect.element(clear).toBeVisible()
  await expect
    .element(page.getByText('Try another search or clear the current filters.', { exact: true }))
    .toBeVisible()
  await clear.click()
  await expect
    .element(page.getByRole('listitem', { name: 'Vendor Screening Agent', exact: true }))
    .toBeVisible()
  await expect
    .element(page.getByRole('listitem', { name: 'Contract Review Agent', exact: true }))
    .toBeVisible()
  await expect.element(clear).not.toBeInTheDocument()
  await expect.element(search).toHaveValue('')
  await expect.element(search).toHaveFocus()
  await expect.element(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
  await expect.element(connectedByMe).not.toBeChecked()
  await expect
    .element(page.getByRole('combobox', { name: 'Sort by', exact: true }))
    .toMatchTextContent('Earliest created')
  await expect
    .poll(() => {
      const params = onUrlUpdate.mock.lastCall?.[0].searchParams
      return params ? Object.fromEntries(params) : undefined
    })
    .toEqual({
      agent_type: 'external',
      external_sort_by: 'earliest_created',
      keyword: 'keep-dify-search',
      filter: 'drafts',
      layout: 'grid',
    })
  expect(onUrlUpdate).toHaveBeenCalledTimes(1)
})
