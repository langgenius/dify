import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { QueryParam } from '../index'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import Filter from '../filter'

async function setup({
  edition = 'CLOUD',
  plan = 'professional',
  initial = {},
}: { edition?: DeploymentEdition; plan?: CloudPlan; initial?: Partial<QueryParam> } = {}) {
  const { wrapper: Providers } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
    features: { billing: { subscription: { plan } } },
  })
  function Filters() {
    const [params, setParams] = useState<QueryParam>({ status: 'all', period: '2', ...initial })
    return <Filter queryParams={params} setQueryParams={setParams} />
  }
  return render(
    <Providers>
      <Filters />
    </Providers>,
  )
}

it.each(['running', 'paused', 'scheduled'] as const)(
  'selects and clears %s while retaining the keyword and period',
  async (status) => {
    const screen = await setup({ initial: { keyword: 'invoice', period: '3' } })
    const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
    await screen.getByRole('combobox', { name: 'appLog.status.all' }).click()
    await screen.getByRole('option', { name: `appLog.status.${status}`, exact: true }).click()
    await expect
      .element(screen.getByRole('combobox', { name: `appLog.status.${status}`, exact: true }))
      .toBeVisible()
    await screen
      .getByRole('button', { name: `common.operation.clear appLog.status.${status}`, exact: true })
      .click()
    await expect.element(screen.getByRole('combobox', { name: 'appLog.status.all' })).toBeVisible()
    await expect.element(search).toHaveValue('invoice')
    await expect
      .element(screen.getByRole('combobox', { name: 'appLog.filter.period.last4weeks' }))
      .toBeVisible()
  },
)

it.each([
  { edition: 'CLOUD', plan: 'sandbox', restricted: true, cleared: 'today' },
  { edition: 'COMMUNITY', plan: 'sandbox', restricted: false, cleared: 'allTime' },
  { edition: 'CLOUD', plan: 'professional', restricted: false, cleared: 'allTime' },
] as const)(
  'uses the $cleared reset and supported periods for $edition $plan',
  async ({ edition, plan, restricted, cleared }) => {
    const screen = await setup({ edition, plan, initial: { keyword: 'invoice', status: 'failed' } })
    await screen.getByRole('combobox', { name: 'appLog.filter.period.last7days' }).click()
    const list = screen.getByRole('listbox')
    if (restricted) {
      await expect
        .element(list.getByRole('option', { name: 'appLog.filter.period.last30days' }))
        .toBeVisible()
      await expect
        .element(list.getByRole('option', { name: 'appLog.filter.period.allTime' }))
        .not.toBeInTheDocument()
      expect(list.getByRole('option').elements()).toHaveLength(3)
    } else {
      await expect
        .element(list.getByRole('option', { name: 'appLog.filter.period.allTime' }))
        .toBeVisible()
    }
    await list.getByRole('option', { name: 'appLog.filter.period.today', exact: true }).click()
    await expect
      .element(screen.getByRole('combobox', { name: 'appLog.filter.period.today' }))
      .toBeVisible()
    await screen
      .getByRole('button', {
        name: 'common.operation.clear appLog.filter.period.today',
        exact: true,
      })
      .click()
    await expect
      .element(
        screen.getByRole('combobox', { name: `appLog.filter.period.${cleared}`, exact: true }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByRole('combobox', { name: 'appLog.status.failed' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('searchbox', { name: 'common.operation.search' }))
      .toHaveValue('invoice')
  },
)

it('edits and clears the keyword without changing the selected status or period', async () => {
  const screen = await setup({ initial: { keyword: 'existing', status: 'failed', period: '3' } })
  const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
  await search.fill('workflow')
  await expect.element(search).toHaveValue('workflow')
  await screen.getByRole('button', { name: 'common.operation.clear', exact: true }).click()
  await expect.element(search).toHaveValue('')
  await expect.element(search).toHaveFocus()
  await expect.element(screen.getByRole('combobox', { name: 'appLog.status.failed' })).toBeVisible()
  await expect
    .element(screen.getByRole('combobox', { name: 'appLog.filter.period.last4weeks' }))
    .toBeVisible()
  await userEvent.keyboard('next')
  await expect.element(search).toHaveValue('next')
})
