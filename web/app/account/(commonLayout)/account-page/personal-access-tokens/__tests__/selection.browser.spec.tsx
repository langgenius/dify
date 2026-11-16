import type {
  GetAccountPersonalAccessTokenResourcesData,
  PersonalAccessTokenCreatedResponse,
  PersonalAccessTokenResourceResponse,
  PersonalAccessTokenResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'
import { renderWithTokenMessages as render } from './browser-test-env'

const responses = vi.hoisted(() => ({ call: vi.fn() }))
// boundary: supply operation results while preserving generated options and real Query observers.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withTokenResponses } = await import('./operation-responses')
  return { ...actual, consoleQuery: withTokenResponses(actual.consoleQuery, responses.call) }
})
vi.unmock('react-i18next')
it('lets users submit a long selected scope on a short narrow viewport', async () => {
  // Real hit testing and nested scrolling prove that the footer remains reachable;
  // the unit selection tests cannot detect horizontal overflow or obstructed controls.
  await page.viewport(320, 600)
  responses.call.mockImplementation(async (operation: string) => {
    if (operation.includes('personalAccessTokenResources'))
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
    if (operation.endsWith('.post')) throw new Error('Service temporarily unavailable')
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
    responses.call.mock.calls.find(([operation]) => operation.endsWith('.post'))?.[1].body
      .resource_scope.resources,
  ).toEqual([{ resource_id: '019a0000-0000-7000-8000-000000000019', resource_type: 'app' }])
  await expect.element(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Long selection')
  const bounds = dialog.element().getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(320)
  expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth)
})

const activeToken: PersonalAccessTokenResponse = {
  id: '019a0000-0000-7000-8000-000000000001',
  name: 'release-pipeline',
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

it.each(['create', 'duplicate'] as const)(
  'keeps the %s dialog open during submission and displays the one-time secret',
  async (entry) => {
    let resolveCreation!: (value: PersonalAccessTokenCreatedResponse) => void
    const creation = new Promise<PersonalAccessTokenCreatedResponse>((resolve) => {
      resolveCreation = resolve
    })
    const previousRows =
      entry === 'duplicate'
        ? [
            ...Array.from({ length: 19 }, (_, index) => ({
              ...activeToken,
              id: `019a0000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`,
              name: `Other token ${index + 1}`,
            })),
            activeToken,
          ]
        : []
    const createdToken = {
      ...activeToken,
      id: '019a0000-0000-7000-8000-000000000999',
      name: 'Pending creation',
    }
    let created = false
    responses.call.mockImplementation(async (operation: string) => {
      if (operation.endsWith('.post')) {
        const result = await creation
        created = true
        return result
      }
      if (operation.includes('byTokenId'))
        return { token: activeToken, resources: [], workspaces: [] }
      return {
        data: created ? [createdToken, ...previousRows].slice(0, 20) : previousRows,
        page: 1,
        limit: 20,
        total: previousRows.length + Number(created),
        has_more: previousRows.length + Number(created) > 20,
      }
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
    if (entry === 'create') await screen.getByRole('button', { name: 'Create token' }).click()
    else
      await screen
        .getByRole('row', { name: /release-pipeline/ })
        .getByRole('button', { name: 'Duplicate', exact: true })
        .click()
    const dialog = screen.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Pending creation')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.element(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await expect.element(dialog.getByRole('button', { name: 'Close' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).toBeVisible()
    await userEvent.click(document.body, { position: { x: 4, y: 4 } })
    await expect.element(dialog).toBeVisible()
    resolveCreation({ ...createdToken, secret: 'dpat_fixture_secret' })
    await expect
      .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
      .toHaveValue('dpat_fixture_secret')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    if (entry === 'duplicate')
      await expect
        .element(screen.getByRole('row', { name: /release-pipeline/ }))
        .not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
  },
)

it('pages resource types independently and counts selections across tabs and search', async () => {
  const base = {
    workspace_id: activeToken.id,
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
  responses.call.mockImplementation(
    async (operation: string, input: Pick<GetAccountPersonalAccessTokenResourcesData, 'query'>) => {
      if (!operation.includes('personalAccessTokenResources'))
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
  expect(responses.call.mock.calls).toContainEqual([
    'account.personalAccessTokenResources.get',
    { query: { cursor: 20, limit: 20, keyword: 'Handbook', resource_type: 'dataset' } },
  ])

  await appsTab.click()
  await search.fill('')
  await expect.element(dialog.getByRole('checkbox', { name: 'Built-in' })).toBeChecked()
  const staging = dialog.getByRole('checkbox', { name: 'Staging' })
  await expect.element(staging).toBeChecked()
  await staging.click()
  await expect.element(dialog.getByRole('tab', { name: 'Apps 1 selected' })).toBeVisible()
})

it('returns keyboard focus to Create token after deletion removes the trigger row', async () => {
  // The feature's list refresh removes the initiating button before the dialog
  // closes. Verify focus restoration through real portal/close transitions.
  let deleted = false
  responses.call.mockImplementation(async (operation: string) => {
    if (operation.endsWith('.delete')) {
      deleted = true
      return undefined
    }
    return {
      data: deleted
        ? []
        : [
            {
              id: '019a0000-0000-7000-8000-000000000001',
              name: 'release-pipeline',
              secret_last_four: '7f21',
              created_at: '2026-10-15T00:00:00Z',
              expires_at: null,
              last_used_at: null,
              resource_scope_mode: 'all',
              workspace_scope_mode: 'all',
              resource_count: 0,
              workspace_count: 0,
              unavailable_count: 0,
              status: 'active',
              version: 1,
            },
          ],
      page: 1,
      limit: 20,
      total: deleted ? 0 : 1,
      has_more: false,
    }
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
  await screen.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(screen.getByText('No personal access tokens')).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
})
