import type { ExternalAgentAssetResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { ConsoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import {
  createExternalAgentAsset,
  createExternalAgentCapabilities,
  createExternalAgentDetail,
  createExternalAgentReferences,
} from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalRoster } from '../external-roster'
import RosterPage from '../page'

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
// boundary: replace Console transport responses while retaining generated keys, policies and observers.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.get': requests.difyList,
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

const vendorId = '44444444-4444-4444-8444-444444444444'
let assets: ExternalAgentAssetResponse[]

async function setup({
  role = 'owner',
  searchParams = '',
  pageOwner = false,
}: { role?: 'owner' | 'editor' | 'normal'; searchParams?: string; pageOwner?: boolean } = {}) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common, app } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role, id: '99999999-9999-4999-8999-999999999999' },
    accountProfile: { id: '11111111-1111-4111-8111-111111111111' },
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    hasMemory: true,
    searchParams,
  })
  onTestFinished(() => queryClient.clear())
  await page.viewport(1440, 900)
  await render(
    <QueryProvider>
      <UrlState>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen flex-col">
            {pageOwner ? <RosterPage /> : <ExternalRoster />}
          </div>
        </I18nextProvider>
      </UrlState>
    </QueryProvider>,
  )
  return { queryClient, onUrlUpdate }
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

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  requests.difyList.mockReset().mockResolvedValue({
    data: [],
    page: 1,
    has_more: false,
    publication_counts: { drafts: 0, published: 0 },
  })
  assets = [
    createExternalAgentAsset({
      id: vendorId,
      name: 'Vendor Screening Agent',
      enabled: false,
      created_by: 'another-actor',
    }),
    createExternalAgentAsset(),
  ]
  requests.capabilities.mockReset().mockResolvedValue(createExternalAgentCapabilities())
  requests.list
    .mockReset()
    .mockImplementation((input: Parameters<ConsoleClient['externalAgents']['get']>[0]) => {
      const query = input?.query ?? {}
      const matched = assets.filter(
        (asset) =>
          (query.enabled === undefined || asset.enabled === query.enabled) &&
          (!query.keyword || asset.name.toLowerCase().includes(query.keyword.toLowerCase())) &&
          (!query.connected_by_me || asset.created_by === '11111111-1111-4111-8111-111111111111'),
      )
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      return {
        items: matched.slice((page - 1) * limit, page * limit),
        total: matched.length,
        page,
        limit,
      }
    })
  requests.detail
    .mockReset()
    .mockImplementation(
      ({ params }: Parameters<ConsoleClient['externalAgents']['byAgentId']['get']>[0]) => {
        const asset = assets.find((item) => item.id === params.agent_id)
        if (!asset) throw new ORPCError('not_found', { status: 404 })
        return createExternalAgentDetail({ asset })
      },
    )
  requests.references.mockReset().mockResolvedValue(createExternalAgentReferences())
  requests.info
    .mockReset()
    .mockImplementation(
      ({
        params,
        body,
      }: Parameters<ConsoleClient['externalAgents']['byAgentId']['info']['patch']>[0]) => {
        const current = assets.find((item) => item.id === params.agent_id)
        if (!current) throw new ORPCError('not_found', { status: 404 })
        const updated = {
          ...current,
          ...body.changes,
          metadata_revision: current.metadata_revision + 1,
        }
        assets = assets.map((item) => (item.id === updated.id ? updated : item))
        return updated
      },
    )
  requests.enabled
    .mockReset()
    .mockImplementation(
      ({
        params,
        body,
      }: Parameters<ConsoleClient['externalAgents']['byAgentId']['enabled']['put']>[0]) => {
        const current = assets.find((item) => item.id === params.agent_id)
        if (!current) throw new ORPCError('not_found', { status: 404 })
        const updated = { ...current, enabled: body.enabled }
        assets = assets.map((item) => (item.id === updated.id ? updated : item))
        return updated
      },
    )
  requests.remove
    .mockReset()
    .mockImplementation(
      ({ params }: Parameters<ConsoleClient['externalAgents']['byAgentId']['delete']>[0]) => {
        assets = assets.filter((item) => item.id !== params.agent_id)
      },
    )
})

it('queries server filters and clears them without touching Dify parameters', async () => {
  const { onUrlUpdate } = await setup({
    searchParams: '?filter=drafts&keyword=keep-dify&layout=grid',
  })
  await expect.element(card('Contract Review Agent')).toBeVisible()
  await page.getByRole('radio', { name: 'Disabled 1', exact: true }).click()
  await expect.element(card('Vendor Screening Agent')).toBeVisible()
  await expect.element(card('Contract Review Agent')).not.toBeInTheDocument()
  await page.getByRole('checkbox', { name: 'Connected by me', exact: true }).click()
  await expect.element(page.getByText('No matching agents', { exact: true })).toBeVisible()
  expect(requests.list).toHaveBeenCalledWith({
    query: { page: 1, limit: 20, enabled: false, connected_by_me: true },
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
  await expect.element(search()).toHaveFocus()
  const cleared = onUrlUpdate.mock.lastCall?.[0].searchParams
  expect(cleared?.get('filter')).toBe('drafts')
  expect(cleared?.get('keyword')).toBe('keep-dify')
  expect(cleared?.get('layout')).toBe('grid')
  expect(cleared?.has('external_keyword')).toBe(false)
  expect(cleared?.has('external_status')).toBe(false)
  expect(cleared?.has('external_connected_by_me')).toBe(false)
})

it('keeps a failed initial list distinct from empty results without a query error or Retry block', async () => {
  const pending = createDeferred<never>()
  requests.list.mockImplementation(() => pending.promise)
  await setup()
  await expect.element(page.getByRole('status')).toBeVisible()
  pending.reject(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }))
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await expect.element(page.getByRole('radio', { name: 'Enabled', exact: true })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'Disabled', exact: true })).toBeVisible()
  await expect
    .element(page.getByText('No external agents yet', { exact: true }))
    .not.toBeInTheDocument()
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
  assets = Array.from({ length: 21 }, (_, index) =>
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
  ).toEqual(assets.map((asset) => asset.name))
  expect(requests.list).toHaveBeenCalledWith({
    query: { page: 2, limit: 20, connected_by_me: false },
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
  requests.references.mockResolvedValue(
    createExternalAgentReferences({
      apps: [
        {
          app_id: 'readable-app',
          name: 'Contract workspace',
          mode: 'workflow',
          node_ids: ['node-1'],
        },
      ],
    }),
  )
  await setup()
  await expect.element(card('Contract Review Agent')).toBeVisible()
  expect(requests.references).not.toHaveBeenCalled()
  await card('Contract Review Agent')
    .getByRole('button', { name: 'Apps using Contract Review Agent', exact: true })
    .click()
  await expect
    .element(page.getByRole('link', { name: 'Contract workspace', exact: true }))
    .toHaveAttribute('href', '/app/readable-app/workflow')
  expect(requests.references).toHaveBeenCalledWith({
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
  assets[1] = createExternalAgentAsset({ metadata_revision: 4 })
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
  assets[1] = createExternalAgentAsset({ name: 'Latest name', metadata_revision: 2 })
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
  const updated = createExternalAgentAsset({ ...assets[0], enabled: true })
  assets[0] = updated
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

it('opens the external page without requesting Dify data and preserves each tab’s filters', async () => {
  const { onUrlUpdate } = await setup({
    pageOwner: true,
    searchParams:
      '?agent_type=external&keyword=internal&filter=drafts&created_by_me=true&sort_by=earliest_created',
  })
  await expect.element(card('Contract Review Agent')).toBeVisible()
  expect(requests.difyList).not.toHaveBeenCalled()
  await page.getByRole('radio', { name: 'Disabled 1', exact: true }).click()
  await page.getByRole('tab', { name: 'Dify agents', exact: true }).click()
  await expect.poll(() => requests.difyList.mock.calls).toHaveLength(1)
  expect(requests.difyList).toHaveBeenCalledWith({
    query: {
      limit: 30,
      page: 1,
      name: 'internal',
      is_created_by_me: true,
      publication_status: 'drafts',
      sort_by: 'earliest_created',
    },
  })
  const params = onUrlUpdate.mock.lastCall?.[0].searchParams
  expect(params?.get('external_status')).toBe('disabled')
  expect(params?.get('keyword')).toBe('internal')
  expect(params?.get('filter')).toBe('drafts')
})
