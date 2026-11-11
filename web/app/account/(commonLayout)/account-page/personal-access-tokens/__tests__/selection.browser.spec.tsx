import type {
  GetAccountPersonalAccessTokenResourcesData,
  PersonalAccessTokenResourceResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page } from 'vite-plus/test/browser'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'
import { render, token } from './browser-test-env'

const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: transport }))
vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(1100, 800)
})

it('lets users submit a long selected scope on a short narrow viewport', async () => {
  // Real hit testing and nested scrolling prove that the footer remains reachable;
  // the unit selection tests cannot detect horizontal overflow or obstructed controls.
  await page.viewport(320, 600)
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('personalAccessTokenResources'))
      return {
        data: Array.from({ length: 20 }, (_, index) => ({
          resource_id: `019a0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
          resource_type: 'app',
          display_name: `Assistant ${index + 1}`,
          workspace_id: '019a0000-0000-7000-8000-000000000099',
          workspace_name: 'Production',
          available: true,
          reason: null,
        })),
        next_cursor: null,
        has_more: false,
      }
    if (path.at(-1) === 'post') throw new Error('Service temporarily unavailable')
    return { data: [], page: 1, limit: 20, total: 0, has_more: false }
  })
  const queryClient = createTestQueryClient()
  seedSystemFeatures(queryClient)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <PersonalAccessTokens />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'Create token' }).click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Long selection')
  await dialog
    .getByRole('radiogroup', { name: 'Resources' })
    .getByRole('radio', { name: 'Selected' })
    .click()
  const search = dialog.getByRole('searchbox')
  await expect.element(search).toBeVisible()
  expect(search.element().getBoundingClientRect().width).toBeGreaterThan(100)
  await dialog.getByRole('checkbox', { name: 'Built-in' }).nth(19).click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  expect(
    transport.call.mock.calls.find(([path]) => path.at(-1) === 'post')?.[1].body.resource_scope
      .resources,
  ).toEqual([{ resource_id: '019a0000-0000-7000-8000-000000000019', resource_type: 'app' }])
  await expect.element(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Long selection')
  const bounds = dialog.element().getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(320)
  expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth)
})

it('pages resource types independently and counts selections across tabs and search', async () => {
  const base = {
    workspace_id: token.id,
    workspace_name: 'Production',
    available: true,
    reason: null,
  }
  const app: PersonalAccessTokenResourceResponse = {
    ...base,
    resource_id: '019a0000-0000-7000-8000-000000000098',
    resource_type: 'app',
    display_name: 'Assistant',
    app_deployments: [
      {
        ...base,
        resource_id: '019a0000-0000-7000-8000-000000000099',
        resource_type: 'app_deployment',
        display_name: 'Assistant / Staging',
        parent_app_id: '019a0000-0000-7000-8000-000000000098',
      },
    ],
  }
  const datasets: PersonalAccessTokenResourceResponse[] = Array.from(
    { length: 21 },
    (_, index) => ({
      ...base,
      resource_id: `019a0000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`,
      resource_type: 'dataset',
      display_name: `Handbook ${index + 1}`,
    }),
  )
  transport.call.mockImplementation(
    async (path: string[], input: Pick<GetAccountPersonalAccessTokenResourcesData, 'query'>) => {
      if (!path.includes('personalAccessTokenResources'))
        return { data: [], page: 1, limit: 20, total: 0, has_more: false }
      const { resource_type, keyword = '', cursor = 0, limit = 20 } = input.query ?? {}
      const resources =
        resource_type === 'app' ? [app] : resource_type === 'dataset' ? datasets : []
      const matches = resources.filter((resource) => resource.display_name.includes(keyword))
      const hasMore = cursor + limit < matches.length
      return {
        data: matches.slice(cursor, cursor + limit),
        next_cursor: hasMore ? cursor + limit : null,
        has_more: hasMore,
      }
    },
  )
  const queryClient = createTestQueryClient()
  seedSystemFeatures(queryClient)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <PersonalAccessTokens />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'Create token' }).click()
  const dialog = screen.getByRole('dialog')
  await dialog
    .getByRole('radiogroup', { name: 'Resources' })
    .getByRole('radio', { name: 'Selected' })
    .click()
  await expect
    .element(dialog.getByRole('tab', { name: 'Apps 0 selected' }))
    .toHaveAttribute('aria-selected', 'true')
  expect(await dialog.getByRole('tab').all()).toHaveLength(2)
  await dialog.getByRole('checkbox', { name: 'Built-in' }).click()
  await dialog.getByRole('checkbox', { name: 'Staging' }).click()
  const dialogHeight = dialog.element().getBoundingClientRect().height

  const search = dialog.getByRole('searchbox')
  await search.fill('Handbook')
  await expect.element(dialog.getByText('No matching resources')).toBeVisible()
  expect(dialog.element().getBoundingClientRect().height).toBe(dialogHeight)
  const appsTab = dialog.getByRole('tab', { name: 'Apps 2 selected' })
  await expect.element(appsTab).toBeVisible()
  await dialog.getByRole('tab', { name: 'Knowledge bases 0 selected' }).click()
  await expect.element(search).toHaveValue('Handbook')
  await expect.element(dialog.getByRole('checkbox', { name: 'Handbook 1' })).toBeVisible()
  expect(dialog.element().getBoundingClientRect().height).toBe(dialogHeight)
  await dialog.getByRole('button', { name: 'Load more resources' }).click()
  await dialog.getByRole('checkbox', { name: 'Handbook 21' }).click()
  await expect.element(dialog.getByRole('status')).toHaveTextContent('All results shown')
  await expect
    .element(dialog.getByRole('tab', { name: 'Knowledge bases 1 selected' }))
    .toBeVisible()
  expect(transport.call.mock.calls).toContainEqual([
    ['account', 'personalAccessTokenResources', 'get'],
    { query: { cursor: 20, limit: 20, keyword: 'Handbook', resource_type: 'dataset' } },
    expect.anything(),
  ])

  await appsTab.click()
  await search.fill('')
  await expect.element(dialog.getByRole('checkbox', { name: 'Built-in' })).toBeChecked()
  const staging = dialog.getByRole('checkbox', { name: 'Staging' })
  await expect.element(staging).toBeChecked()
  await staging.click()
  await expect.element(dialog.getByRole('tab', { name: 'Apps 1 selected' })).toBeVisible()
})
