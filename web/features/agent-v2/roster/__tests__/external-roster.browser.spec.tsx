import type {
  ExternalAgentAssetResponse,
  ExternalAgentListResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import { ORPCError } from '@orpc/client'
import { onTestFinished } from 'vite-plus/test'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createExternalAgentAsset,
  createExternalAgentCapabilities,
  createExternalAgentReferences,
} from '@/test/console/external-agents'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createRosterFixture, resetRoster, server, vendorId } from './external-roster-fixture'

// boundary: the fixture supplies real English labels for browser interaction.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const requests = vi.hoisted(() => ({
  list: vi.fn(),
  capabilities: vi.fn(),
  detail: vi.fn(),
  references: vi.fn(),
  info: vi.fn(),
  enabled: vi.fn(),
  remove: vi.fn(),
  difyList: vi.fn(),
}))
const agentTags = vi.hoisted(() => [
  { id: '00000000-0000-4000-8000-000000000011', name: 'Research', type: 'agent' as const },
  { id: '00000000-0000-4000-8000-000000000012', name: 'Finance', type: 'agent' as const },
])
// boundary: replace Console transport responses while retaining generated keys, policies and observers.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.get': requests.difyList,
      'tags.get': () => agentTags,
      'externalAgents.get': requests.list,
      'externalAgents.capabilities.get': requests.capabilities,
      'externalAgents.byAgentId.get': requests.detail,
      'externalAgents.byAgentId.references.get': requests.references,
      'externalAgents.byAgentId.info.patch': requests.info,
      'externalAgents.byAgentId.enabled.put': requests.enabled,
      'externalAgents.byAgentId.delete': requests.remove,
    }),
  }
})
// boundary: app routing is external to this rendered Roster owner.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

beforeEach(() => {
  resetRoster(requests)
  onTestFinished(guardUnexpectedFetch())
})

async function setup(options?: Parameters<typeof createRosterFixture>[0]) {
  const result = await createRosterFixture(options)
  await page.viewport(1440, 900)
  const rendered = await render(result.ui)
  onTestFinished(async () => {
    await rendered.unmount()
    result.queryClient.clear()
  })
  return result
}
const card = (name: string) => page.getByRole('listitem', { name, exact: true })
const search = () => page.getByRole('searchbox', { name: 'Search agents', exact: true })
async function openActions(name: string) {
  await expect.element(card(name)).toBeVisible()
  await card(name).hover()
  await card(name)
    .getByRole('button', { name: `More actions for ${name}`, exact: true })
    .click()
}

it('uses status totals from the selected list response without separate count requests', async () => {
  const response: ExternalAgentListResponse = {
    items: [server.assets[0]!],
    enabled_count: 8,
    disabled_count: 1,
    total: 1,
    page: 1,
    limit: 20,
  }
  requests.list.mockResolvedValue(response)
  await setup({ searchParams: '?external_status=disabled' })

  await expect.element(card('Vendor Screening Agent')).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Enabled 8', exact: true })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Disabled 1', exact: true })).toBeChecked()
  expect(requests.list).toHaveBeenCalledExactlyOnceWith({
    query: {
      page: 1,
      limit: 20,
      enabled: false,
      connected_by_me: false,
      sort_by: 'updated_at',
      sort_order: 'desc',
    },
  })
  expect(requests.references).not.toHaveBeenCalled()
})

it('requests each server sort and keeps external and Dify filters in the URL', async () => {
  const { onUrlUpdate } = await setup({
    searchParams:
      '?external_status=disabled&external_keyword=Vendor&filter=drafts&sort_by=earliest_created',
  })
  await expect.element(card('Vendor Screening Agent')).toBeVisible()
  const sort = page.getByRole('combobox', { name: 'Sort by', exact: true })
  await expect.element(sort).toBeEnabled()

  for (const [label, value, sortBy, sortOrder] of [
    ['Recently created', 'recently_created', 'created_at', 'desc'],
    ['Earliest created', 'earliest_created', 'created_at', 'asc'],
    ['Last modified', 'last_modified', 'updated_at', 'desc'],
  ] as const) {
    await sort.click()
    await page.getByRole('option', { name: label, exact: true }).click()
    await expect.element(sort).toMatchTextContent(label)
    // Returning to the default sort can reuse its already-fetched query result.
    await expect
      .poll(() => requests.list.mock.calls.map(([input]) => input))
      .toContainEqual({
        query: {
          page: 1,
          limit: 20,
          keyword: 'Vendor',
          enabled: false,
          connected_by_me: false,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      })
    const params = onUrlUpdate.mock.lastCall?.[0].searchParams
    expect(params?.get('external_sort_by')).toBe(value === 'last_modified' ? null : value)
    expect(params?.get('external_status')).toBe('disabled')
    expect(params?.get('external_keyword')).toBe('Vendor')
    expect(params?.get('filter')).toBe('drafts')
    expect(params?.get('sort_by')).toBe('earliest_created')
  }
})

it('clears external filters while preserving sorting and Dify parameters and restoring All focus', async () => {
  const { onUrlUpdate } = await setup({
    searchParams: '?filter=drafts&keyword=keep-dify&layout=grid&external_sort_by=earliest_created',
  })
  await expect.element(card('Contract Review Agent')).toBeVisible()
  const filtered = createDeferred<ExternalAgentListResponse>()
  requests.list.mockImplementationOnce(() => filtered.promise)
  await page.getByRole('radio', { name: 'Disabled 1', exact: true }).click()
  await expect.element(page.getByRole('radio', { name: 'Enabled 1', exact: true })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Disabled 1', exact: true })).toBeChecked()
  await expect.element(card('Contract Review Agent')).toBeVisible()
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  filtered.resolve({
    items: [server.assets[0]!],
    enabled_count: 1,
    disabled_count: 1,
    total: 1,
    page: 1,
    limit: 20,
  })
  await expect.element(card('Vendor Screening Agent')).toBeVisible()
  await expect.element(card('Contract Review Agent')).not.toBeInTheDocument()
  await page.getByRole('checkbox', { name: 'Connected by me', exact: true }).click()
  await expect.element(page.getByText('No matching agents', { exact: true })).toBeVisible()
  expect(requests.list).toHaveBeenCalledWith({
    query: {
      page: 1,
      limit: 20,
      enabled: false,
      connected_by_me: true,
      sort_by: 'created_at',
      sort_order: 'asc',
    },
  })
  await search().fill('vendor')
  await expect
    .poll(() =>
      requests.list.mock.calls.some(
        ([input]) => input.query.keyword === 'vendor' && input.query.limit === 20,
      ),
    )
    .toBe(true)
  const params = onUrlUpdate.mock.lastCall?.[0].searchParams
  expect(params?.get('external_keyword')).toBe('vendor')
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect.element(card('Contract Review Agent')).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'All', exact: true })).toHaveFocus()
  await expect.element(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
  await expect.element(search()).toHaveValue('')
  await expect
    .element(page.getByRole('combobox', { name: 'Sort by', exact: true }))
    .toMatchTextContent('Earliest created')
  const cleared = onUrlUpdate.mock.lastCall?.[0].searchParams
  expect(cleared?.get('filter')).toBe('drafts')
  expect(cleared?.get('keyword')).toBe('keep-dify')
  expect(cleared?.get('layout')).toBe('grid')
  expect(cleared?.get('external_sort_by')).toBe('earliest_created')
  expect(cleared?.has('external_keyword')).toBe(false)
  expect(cleared?.has('external_status')).toBe(false)
  expect(cleared?.has('external_connected_by_me')).toBe(false)
})

it('keeps a failed initial list distinct from empty results without a query error or Retry block', async () => {
  const pending = createDeferred<never>()
  requests.list.mockImplementation(() => pending.promise)
  await setup()
  await expect.element(page.getByRole('status')).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Enabled 0', exact: true })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Disabled 0', exact: true })).toBeVisible()
  pending.reject(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }))
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await expect.element(page.getByRole('radio', { name: 'Enabled 0', exact: true })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Disabled 0', exact: true })).toBeVisible()
  await expect.element(page.getByText('No agent yet', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
})

it('keeps unavailable references distinct from zero apps without a query error or Retry block', async () => {
  const pending = createDeferred<never>()
  requests.references.mockImplementation(() => pending.promise)
  await setup()
  const trigger = card('Contract Review Agent').getByRole('button', {
    name: 'Apps using Contract Review Agent',
    exact: true,
  })
  await trigger.click()
  await expect.element(page.getByRole('status')).toBeVisible()
  pending.reject(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }))
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveTextContent('Apps')
  await expect
    .element(page.getByText('No apps using this agent are visible to you.', { exact: true }))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
})

it('appends actual server pages in returned order and resets pagination on a new filter', async () => {
  server.assets = Array.from({ length: 21 }, (_, index) =>
    createExternalAgentAsset({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `Server order ${index}`,
      created_at: index === 20 ? '2026-11-12T12:00:00Z' : '2026-11-01T12:00:00Z',
    }),
  )
  await setup({ searchParams: '?external_sort_by=recently_created' })
  await expect.element(card('Server order 0')).toBeVisible()
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect.element(card('Server order 20')).toBeInTheDocument()
  expect(
    page
      .getByRole('heading', { level: 2 })
      .elements()
      .map((heading) => heading.textContent),
  ).toEqual(server.assets.map((asset) => asset.name))
  expect(requests.list).toHaveBeenCalledWith({
    query: {
      page: 2,
      limit: 20,
      connected_by_me: false,
      sort_by: 'created_at',
      sort_order: 'desc',
    },
  })
  await page.getByRole('radio', { name: 'Enabled 21', exact: true }).click()
  await expect
    .poll(() =>
      requests.list.mock.calls.some(
        ([input]) =>
          input.query.page === 1 && input.query.limit === 20 && input.query.enabled === true,
      ),
    )
    .toBe(true)
  await expect.element(card('Server order 20')).not.toBeInTheDocument()
})

it('loads permitted reference links only after the reference popup opens', async () => {
  server.assets[0] = { ...server.assets[0]!, reference_count: 0 }
  server.assets[1] = { ...server.assets[1]!, reference_count: 7 }
  requests.references.mockResolvedValue(
    createExternalAgentReferences({
      apps: [
        {
          app_id: 'readable-app',
          name: 'Contract workspace',
          mode: 'workflow',
          node_ids: ['node-1'],
          icon_type: null,
          icon: null,
          icon_background: null,
          icon_url: null,
        },
      ],
    }),
  )
  await setup()
  await expect.element(card('Contract Review Agent')).toBeVisible()
  const trigger = card('Contract Review Agent').getByRole('button', {
    name: 'Apps using Contract Review Agent',
    exact: true,
  })
  await expect.element(trigger).toHaveTextContent('7 apps')
  await expect
    .element(
      card('Vendor Screening Agent').getByRole('button', {
        name: 'Apps using Vendor Screening Agent',
        exact: true,
      }),
    )
    .toHaveTextContent('0 apps')
  expect(requests.references).not.toHaveBeenCalled()
  await trigger.click()
  await expect
    .element(page.getByRole('link', { name: 'Contract workspace', exact: true }))
    .toHaveAttribute('href', '/app/readable-app/workflow')
  await expect.element(trigger).toHaveTextContent('7 apps')
  expect(requests.references).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: createExternalAgentAsset().id },
  })
})

it.each(['editor', 'normal'] as const)(
  'restricts %s management while routing only to the permitted surface',
  async (role) => {
    await setup({ role })
    await expect
      .element(page.getByRole('button', { name: 'Connect external agent', exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /More actions for/ }))
      .not.toBeInTheDocument()
    await expect
      .element(
        card('Contract Review Agent').getByRole('link', {
          name: 'Contract Review Agent',
          exact: true,
        }),
      )
      .toHaveAttribute(
        'href',
        `/external-agent/${createExternalAgentAsset().id}/${role === 'normal' ? 'monitoring' : 'overview'}`,
      )
    if (role === 'normal')
      await expect
        .element(
          card('Contract Review Agent').getByRole('button', {
            name: 'Apps using Contract Review Agent',
            exact: true,
          }),
        )
        .not.toBeInTheDocument()
    expect(requests.detail).not.toHaveBeenCalled()
    expect(requests.references).not.toHaveBeenCalled()
  },
)

it('keeps asset management available when execution is disabled but blocks new connections', async () => {
  requests.capabilities.mockResolvedValue(createExternalAgentCapabilities({ enabled: false }))
  await setup()
  await expect
    .element(page.getByRole('button', { name: 'Connect external agent', exact: true }))
    .toBeDisabled()
  await openActions('Contract Review Agent')
  await expect.element(page.getByRole('menuitem', { name: 'Edit info', exact: true })).toBeVisible()
})

it('keeps canceled info drafts local and PATCHes only changed fields with the loaded metadata revision', async () => {
  server.assets[1] = createExternalAgentAsset({ metadata_revision: 4 })
  await setup()
  await openActions('Contract Review Agent')
  await page.getByRole('menuitem', { name: 'Edit info', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit info', exact: true })
  const name = dialog.getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('Discard this draft')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await openActions('Contract Review Agent')
  await page.getByRole('menuitem', { name: 'Edit info', exact: true }).click()
  await expect.element(name).toHaveValue('Contract Review Agent')
  await name.fill(' Contract Analyzer ')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(card('Contract Analyzer')).toBeVisible()
  expect(requests.info).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: createExternalAgentAsset().id },
    body: { expected_revision: 4, changes: { name: 'Contract Analyzer' } },
  })
})

it('preserves a conflicted info draft until explicitly loading the latest metadata revision', async () => {
  requests.info.mockRejectedValueOnce(new ORPCError('conflict', { status: 409 }))
  await setup()
  await openActions('Contract Review Agent')
  await page.getByRole('menuitem', { name: 'Edit info', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit info', exact: true })
  const name = dialog.getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('My draft')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(
      dialog.getByText('This configuration changed. Load the latest version before saving again.', {
        exact: true,
      }),
    )
    .toBeVisible()
  await expect.element(name).toHaveValue('My draft')
  server.assets[1] = createExternalAgentAsset({ name: 'Latest name', metadata_revision: 2 })
  await dialog.getByRole('button', { name: 'Load latest configuration', exact: true }).click()
  await expect.element(name).toHaveValue('Latest name')
  await name.fill('Final name')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(card('Final name')).toBeVisible()
  expect(requests.info).toHaveBeenLastCalledWith({
    params: { agent_id: createExternalAgentAsset().id },
    body: { expected_revision: 2, changes: { name: 'Final name' } },
  })
})

it('waits for the server enabled result before updating filtered results and global totals', async () => {
  const saved = createDeferred<ExternalAgentAssetResponse>()
  requests.enabled.mockImplementationOnce(() => saved.promise)
  await setup({ searchParams: '?external_status=disabled' })
  await openActions('Vendor Screening Agent')
  await page.getByRole('menuitem', { name: 'Enable agent', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Enable agent?', exact: true })
  await dialog.getByRole('button', { name: 'Enable agent', exact: true }).click()
  await expect
    .element(dialog.getByRole('button', { name: 'Enable agent', exact: true }))
    .toBeDisabled()
  expect(requests.enabled).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: vendorId },
    body: { enabled: true },
  })
  const updated = createExternalAgentAsset({ ...server.assets[0], enabled: true })
  server.assets[0] = updated
  saved.resolve(updated)
  await expect.element(page.getByText('No matching agents', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Enabled 2', exact: true })).toBeVisible()
})

it('requires a deletion-impact response and retains reachable focus after server-confirmed removal', async () => {
  const impact = createDeferred<ReturnType<typeof createExternalAgentReferences>>()
  requests.references.mockImplementationOnce(() => impact.promise)
  await setup()
  await openActions('Vendor Screening Agent')
  await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete agent?', exact: true })
  await expect
    .element(dialog.getByRole('button', { name: 'Delete agent', exact: true }))
    .toBeDisabled()
  impact.resolve(createExternalAgentReferences({ may_have_in_flight: true }))
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(requests.remove).not.toHaveBeenCalled()
  await openActions('Vendor Screening Agent')
  await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click()
  await expect
    .element(dialog.getByRole('button', { name: 'Delete agent', exact: true }))
    .toBeEnabled()
  await dialog.getByRole('button', { name: 'Delete agent', exact: true }).click()
  await expect.element(card('Vendor Screening Agent')).not.toBeInTheDocument()
  expect(requests.remove).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: vendorId } })
  await expect
    .element(page.getByRole('link', { name: 'Contract Review Agent', exact: true }))
    .toHaveFocus()
})

it('loads only the active roster and removes outgoing filters from the URL on tab changes', async () => {
  const tagIds = agentTags.map((tag) => tag.id)
  const { onUrlUpdate } = await setup({
    pageOwner: true,
    searchParams:
      '?agent_type=external&external_keyword=Contract&external_status=enabled' +
      '&external_connected_by_me=true&external_sort_by=earliest_created' +
      `&keyword=internal&filter=drafts&tag_ids=${tagIds.join(';')}&created_by_me=true` +
      '&sort_by=earliest_created&utm_source=blog',
  })
  await expect.element(card('Contract Review Agent')).toBeVisible()
  expect(requests.difyList).not.toHaveBeenCalled()
  const urlParams = () => Object.fromEntries(onUrlUpdate.mock.lastCall?.[0].searchParams ?? [])

  await page.getByRole('tab', { name: 'Dify agents', exact: true }).click()
  await expect.poll(urlParams).toEqual({
    keyword: 'internal',
    filter: 'drafts',
    tag_ids: tagIds.join(';'),
    created_by_me: 'true',
    sort_by: 'earliest_created',
    utm_source: 'blog',
  })
  await expect.poll(() => requests.difyList.mock.calls).toHaveLength(1)
  expect(requests.difyList).toHaveBeenCalledWith({
    query: {
      limit: 30,
      page: 1,
      name: 'internal',
      tag_ids: tagIds,
      is_created_by_me: true,
      publication_status: 'drafts',
      sort_by: 'earliest_created',
    },
  })

  await page.getByRole('tab', { name: 'External agents', exact: true }).click()
  await expect.poll(urlParams).toEqual({ agent_type: 'external', utm_source: 'blog' })
  await expect.element(card('Vendor Screening Agent')).toBeVisible()
})
