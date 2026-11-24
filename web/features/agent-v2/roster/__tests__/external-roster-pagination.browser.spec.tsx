import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createExternalAgentAsset,
  createExternalAgentCapabilities,
} from '@/test/console/external-agents'
import { installFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { createRosterFixture } from './external-roster-fixture'

vi.unmock('react-i18next')

it('restarts cached unfiltered External Agent pages after clearing an empty tag filter while preserving sorting and focus', async ({
  onTestFinished,
}) => {
  const research = {
    id: '00000000-0000-4000-8000-000000000011',
    name: 'Research',
    type: 'agent',
  }
  const firstPage = Array.from({ length: 20 }, (_, index) =>
    createExternalAgentAsset({
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      name: `Unfiltered Agent ${index + 1}`,
      reference_count: 0,
    }),
  )
  const later = createExternalAgentAsset({
    id: '00000000-0000-4000-8000-000000000121',
    name: 'Second-page Agent',
    reference_count: 0,
  })
  const api = installFakeApi({
    console: {
      externalAgents: {
        capabilities: { get: () => createExternalAgentCapabilities() },
        get: (input) => {
          const query = input?.query
          const filtered = Boolean(query?.tag_ids?.length)
          return {
            items: filtered ? [] : query?.page === 2 ? [later] : firstPage,
            total: filtered ? 0 : 21,
            enabled_count: filtered ? 0 : 21,
            disabled_count: 0,
            page: query?.page ?? 1,
            limit: 20,
          }
        },
      },
      tags: { get: () => [research] },
    },
  })
  const fixture = await createRosterFixture({
    searchParams: '?external_sort_by=earliest_created&layout=grid',
  })
  const { NavigationProvider } = createTestNavigation({
    url: '/agents?external_sort_by=earliest_created&layout=grid',
  })
  await page.viewport(1440, 900)
  const rendered = await render(<NavigationProvider>{fixture.ui}</NavigationProvider>)
  onTestFinished(async () => {
    await rendered.unmount()
    fixture.queryClient.clear()
    await api()
  })

  const first = page.getByRole('listitem', { name: 'Unfiltered Agent 1', exact: true })
  const second = page.getByRole('listitem', { name: later.name, exact: true })
  const loadMore = page.getByRole('button', { name: 'Load more', exact: true })
  const list = api.console.externalAgents.get
  const unfilteredQuery = {
    connected_by_me: false,
    limit: 20,
    sort_by: 'created_at',
    sort_order: 'asc',
  }
  await expect.element(first).toBeVisible()
  await loadMore.click()
  await expect.element(second).toBeVisible()
  expect(list).toHaveBeenLastCalledWith({ query: { ...unfilteredQuery, page: 2 } })

  await page.getByRole('combobox', { name: 'Tags', exact: true }).click()
  await page.getByRole('option', { name: 'Research', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  const clear = page.getByRole('button', { name: 'Clear filters', exact: true })
  await expect.element(clear).toBeVisible()
  await expect.element(first).not.toBeInTheDocument()
  expect(list).toHaveBeenLastCalledWith({
    query: { ...unfilteredQuery, page: 1, tag_ids: [research.id] },
  })

  list.mockClear()
  await clear.click()
  await expect.element(page.getByRole('radio', { name: 'All', exact: true })).toHaveFocus()
  await expect.element(first).toBeVisible()
  await expect.element(second).not.toBeInTheDocument()
  await expect.element(loadMore).toBeEnabled()
  expect(list).toHaveBeenCalledExactlyOnceWith({ query: { ...unfilteredQuery, page: 1 } })
  await expect
    .poll(() => Object.fromEntries(fixture.onUrlUpdate.mock.lastCall?.[0].searchParams ?? []))
    .toEqual({ external_sort_by: 'earliest_created', layout: 'grid' })

  await loadMore.click()
  await expect.element(second).toBeVisible()
  expect(list).toHaveBeenCalledTimes(2)
  expect(list).toHaveBeenLastCalledWith({ query: { ...unfilteredQuery, page: 2 } })
})
