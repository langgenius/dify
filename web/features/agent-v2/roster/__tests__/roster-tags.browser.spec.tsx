import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { consoleClient } from '@/service/console'
import { zAgentAppPagination } from '@dify/contracts/api/console/agent/zod.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { AgentPermission } from '@/features/agent-v2/acl'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedTags } from '@/test/console/tags'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import RosterPage from '../page'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.agent.get>(),
  tags: vi.fn<typeof consoleClient.tags.get>(),
  deleteTag: vi.fn<typeof consoleClient.tags.byTagId.delete>(),
  bind: vi.fn<typeof consoleClient.tagBindings.post>(),
  unbind: vi.fn<typeof consoleClient.tagBindings.remove.post>(),
}))

// boundary: supply the generated Console transport responses while exercising the real page and tag controls.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.get': api.list,
      'tags.get': api.tags,
      'tags.byTagId.delete': api.deleteTag,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'tagBindings.post': api.bind,
      'tagBindings.remove.post': api.unbind,
    }),
  }
})

const research = { id: 'research', name: 'Research', type: 'agent' }
const finance = { id: 'finance', name: 'Finance', type: 'agent' }
const compliance = {
  id: 'compliance',
  name: 'International compliance and reporting',
  type: 'agent',
}
const analyst = createAgentFixture({
  id: 'analyst',
  name: 'Analyst',
  tags: [research],
  permission_keys: [AgentPermission.Edit],
})
const reviewer = {
  ...createAgentFixture({
    id: 'reviewer',
    name: 'Reviewer',
    tags: [research, compliance],
    permission_keys: [AgentPermission.AccessPointView],
  }),
  active_config_is_published: true,
}

function rosterPage(data: AgentAppPartial[], pageNumber = 1, hasMore = false) {
  return zAgentAppPagination.parse({
    data,
    page: pageNumber,
    limit: 30,
    total: hasMore ? data.length + 1 : data.length,
    has_more: hasMore,
    publication_counts: { published: 1, drafts: 1 },
  })
}

async function renderRoster(
  workspacePermissionKeys: string[],
  searchParams = '',
  client?: QueryClient,
) {
  const { wrapper: ConsoleProvider, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys,
    queryClient: client,
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  const { unmount } = await render(
    <ConsoleProvider>
      <UrlState>
        <div className="isolate flex h-screen flex-col">
          <RosterPage />
          <AppToaster />
        </div>
      </UrlState>
    </ConsoleProvider>,
  )
  return { onUrlUpdate, queryClient, unmount }
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  api.tags.mockResolvedValue([research, finance])
  api.list.mockResolvedValue(rosterPage([analyst, reviewer]))
})

it('paginates filtered Agents, restarts for a second tag and clears only the tag filter', async () => {
  api.list.mockImplementation(async (input: Parameters<typeof consoleClient.agent.get>[0]) => {
    const query = input?.query
    if (query?.tag_ids?.length === 2) return rosterPage([])
    if (query?.tag_ids?.length === 1)
      return query.page === 2 ? rosterPage([reviewer], 2) : rosterPage([analyst], 1, true)
    return rosterPage([reviewer])
  })
  const { onUrlUpdate } = await renderRoster([], '?tag_ids=research&sort_by=earliest_created')
  await expect.element(page.getByRole('listitem', { name: 'Analyst' })).toBeVisible()
  await page.getByRole('button', { name: 'agentRoster.roster.loadMore' }).click()
  await expect.element(page.getByRole('listitem', { name: 'Reviewer' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Research' }).click()
  await page.getByRole('option', { name: 'Finance' }).click()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('status', { name: 'agentRoster.roster.emptySearch' }))
    .toBeVisible()
  expect(api.list).toHaveBeenLastCalledWith({
    query: { page: 1, limit: 30, tag_ids: [research.id, finance.id], sort_by: 'earliest_created' },
  })
  await page.getByRole('button', { name: 'common.operation.clear' }).click()
  await expect.element(page.getByRole('listitem', { name: 'Reviewer' })).toBeVisible()
  expect(api.list).toHaveBeenLastCalledWith({
    query: { page: 1, limit: 30, sort_by: 'earliest_created' },
  })
  expect(onUrlUpdate).toHaveBeenLastCalledWith(
    expect.objectContaining({ queryString: '?sort_by=earliest_created' }),
  )
  await page.getByRole('combobox', { name: 'common.tag.placeholder' }).click()
  await page.getByRole('option', { name: 'Research' }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('listitem', { name: 'Analyst' })).toBeVisible()
  await expect.element(page.getByRole('listitem', { name: 'Reviewer' })).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'agentRoster.roster.loadMore' }))
    .toBeVisible()
})

it('clears an unmatched search and all roster filters while preserving other URL state and restoring search focus', async () => {
  api.list.mockImplementation(async (input) => {
    const query = input?.query
    const filtered =
      query?.name || query?.publication_status || query?.is_created_by_me || query?.tag_ids?.length
    return rosterPage(filtered ? [] : [analyst])
  })
  const { onUrlUpdate } = await renderRoster(
    [],
    '?keyword=kkkkk&sort_by=earliest_created&layout=grid',
  )
  const search = page.getByRole('searchbox', { name: 'agentRoster.roster.searchLabel' })
  await expect.element(search).toHaveValue('kkkkk')
  const clear = page.getByRole('button', { name: 'agentRoster.roster.clearFilters' })
  await expect.element(clear).toBeVisible()

  await page.getByRole('radio', { name: /agentRoster\.roster\.filters\.drafts/ }).click()
  await page.getByRole('checkbox', { name: 'agentRoster.roster.filters.createdByMe' }).click()
  await page.getByRole('combobox', { name: 'common.tag.placeholder' }).click()
  await page.getByRole('option', { name: 'Research' }).click()
  await userEvent.keyboard('{Escape}')
  await expect
    .poll(() => api.list.mock.lastCall?.[0]?.query)
    .toEqual({
      name: 'kkkkk',
      publication_status: 'drafts',
      is_created_by_me: true,
      tag_ids: [research.id],
      sort_by: 'earliest_created',
      page: 1,
      limit: 30,
    })

  await clear.click()
  await expect.element(search).toHaveFocus()
  await expect.element(search).toHaveValue('')
  await expect.element(page.getByRole('listitem', { name: 'Analyst' })).toBeVisible()
  await expect
    .poll(() => Object.fromEntries(onUrlUpdate.mock.lastCall?.[0].searchParams ?? []))
    .toEqual({
      sort_by: 'earliest_created',
      layout: 'grid',
    })
})

it('restores loaded roster pages when returning from another route with the same filters', async () => {
  api.list.mockImplementation(async (input) =>
    input?.query?.page === 2 ? rosterPage([reviewer], 2) : rosterPage([analyst], 1, true),
  )
  const firstVisit = await renderRoster([], '?tag_ids=research')
  await page.getByRole('button', { name: 'agentRoster.roster.loadMore' }).click()
  await expect.element(page.getByRole('listitem', { name: 'Reviewer' })).toBeVisible()
  await firstVisit.unmount()
  await expect.element(page.getByRole('listitem', { name: 'Reviewer' })).not.toBeInTheDocument()
  await renderRoster([], '?tag_ids=research', firstVisit.queryClient)
  await expect.element(page.getByRole('listitem', { name: 'Reviewer' })).toBeVisible()
  expect(api.list).toHaveBeenCalledTimes(2)
})

it('reconciles a bookmarked tag filter with the catalog and keeps the remaining selection after deletion', async () => {
  const catalog = createDeferred<(typeof research)[]>()
  api.tags.mockReturnValue(catalog.promise)
  api.list.mockImplementation(async (input) =>
    rosterPage(input?.query?.tag_ids?.length === 1 ? [reviewer] : [analyst]),
  )
  api.deleteTag.mockImplementation(async () => {
    api.tags.mockResolvedValue([finance])
  })
  const { onUrlUpdate } = await renderRoster(
    ['agent.tag.manage'],
    '?tag_ids=gone;research;finance&sort_by=earliest_created',
  )
  await expect.element(page.getByRole('listitem', { name: 'Analyst' })).toBeVisible()
  expect(onUrlUpdate).not.toHaveBeenCalled()
  catalog.resolve([research, finance])
  const filter = page.getByRole('combobox', { name: 'Research, Finance' })
  await expect.element(filter).toBeVisible()
  await expect
    .poll(() => onUrlUpdate.mock.lastCall?.[0].searchParams.get('tag_ids'))
    .toBe('research;finance')
  await filter.click()
  await page.getByRole('button', { name: 'common.tag.manageTags' }).click()
  const management = page.getByRole('dialog', { name: 'common.tag.manageTags' })
  await management.getByRole('button', { name: 'common.operation.remove Research' }).click()
  await expect
    .element(management.getByRole('button', { name: 'common.operation.remove Research' }))
    .not.toBeInTheDocument()
  await management.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(page.getByRole('combobox', { name: 'Finance' })).toBeVisible()
  await expect.element(page.getByRole('listitem', { name: 'Reviewer' })).toBeVisible()
  expect(api.list).toHaveBeenLastCalledWith({
    query: { page: 1, limit: 30, tag_ids: [finance.id], sort_by: 'earliest_created' },
  })
  expect(onUrlUpdate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      queryString: '?tag_ids=finance&sort_by=earliest_created',
    }),
  )
})

it('keeps a bookmarked tag that was added after the catalog was cached', async () => {
  const queryClient = createConsoleQueryClient()
  seedTags(queryClient, [research])
  const catalog = createDeferred<(typeof research)[]>()
  api.tags.mockReturnValue(catalog.promise)
  const { onUrlUpdate } = await renderRoster([], '?tag_ids=finance', queryClient)
  await expect.element(page.getByRole('listitem', { name: 'Analyst' })).toBeVisible()
  catalog.resolve([research, finance])
  await expect.element(page.getByRole('combobox', { name: 'Finance' })).toBeVisible()
  expect(onUrlUpdate).not.toHaveBeenCalled()
  expect(api.list).toHaveBeenCalledExactlyOnceWith({
    query: { page: 1, limit: 30, tag_ids: [finance.id], sort_by: 'last_modified' },
  })
})

it('lets an Agent editor change bindings without permission to manage shared tags', async () => {
  await renderRoster([])
  await expect
    .element(page.getByRole('listitem', { name: 'Reviewer' }).getByRole('combobox'))
    .not.toBeInTheDocument()
  await page.getByRole('combobox', { name: 'Research: Analyst' }).click()
  const search = page.getByRole('combobox', { name: 'common.tag.searchTags' })
  await expect.element(search).toHaveAttribute('placeholder', 'common.tag.searchTags')
  await search.fill('Planning')
  await expect.element(page.getByText('common.tag.noTag')).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'common.tag.manageTags' }))
    .not.toBeInTheDocument()
  await search.fill('')
  await page.getByRole('option', { name: 'Finance' }).click()
  await page.getByRole('option', { name: 'Research' }).click()
  await userEvent.keyboard('{Escape}')
  await expect
    .poll(() => api.bind.mock.calls[0]?.[0])
    .toEqual({
      body: { target_id: analyst.id, type: 'agent', tag_ids: [finance.id] },
    })
  expect(api.unbind.mock.calls[0]?.[0]).toEqual({
    body: { target_id: analyst.id, type: 'agent', tag_ids: [research.id] },
  })
})

it('opens shared tag management while keeping bindings read-only on Agents without edit access', async () => {
  await renderRoster(['agent.tag.manage'])
  const readOnlyTags = page.getByRole('button', { name: /Research.*Reviewer/ })
  const reviewerLink = page.getByRole('link', { name: 'Reviewer' })
  await expect.element(reviewerLink).toBeVisible()
  reviewerLink.element().focus()
  await userEvent.tab()
  await expect.element(readOnlyTags).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const tagDetails = page.getByRole('dialog', { name: 'common.tag.tags: Reviewer' })
  await expect.element(tagDetails.getByText(compliance.name)).toBeVisible()
  await expect.element(tagDetails.getByText(research.name)).toBeVisible()
  await expect.element(tagDetails.getByRole('combobox')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(tagDetails).not.toBeInTheDocument()
  await expect.element(readOnlyTags).toHaveFocus()
  await page.getByRole('combobox', { name: 'common.tag.placeholder' }).click()
  await page.getByRole('button', { name: 'common.tag.manageTags' }).click()
  const management = page.getByRole('dialog', { name: 'common.tag.manageTags' })
  await expect.element(management.getByRole('textbox', { name: 'common.tag.addNew' })).toBeVisible()
  await management.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(management).not.toBeInTheDocument()
  await page.getByRole('combobox', { name: 'Research: Analyst' }).click()
  await page.getByRole('combobox', { name: 'common.tag.selectorPlaceholder' }).fill('Planning')
  await expect.element(page.getByRole('option', { name: /Planning/ })).toBeVisible()
  await page.getByRole('button', { name: 'common.tag.manageTags' }).click()
  await expect
    .element(management.getByRole('button', { name: 'common.operation.edit Research' }))
    .toBeVisible()
})

it('reports a failed binding after the successful removal drops the Agent from the filtered roster', async () => {
  onTestFinished(() => toast.dismiss())
  api.list.mockResolvedValue(rosterPage([analyst]))
  await renderRoster([], '?tag_ids=research')
  const card = page.getByRole('listitem', { name: 'Analyst' })
  await card.getByRole('combobox', { name: 'Research: Analyst' }).click()
  await page.getByRole('option', { name: 'Finance' }).click()
  await page.getByRole('option', { name: 'Research' }).click()

  const catalogRefresh = createDeferred<Awaited<ReturnType<typeof consoleClient.tags.get>>>()
  api.tags.mockReturnValueOnce(catalogRefresh.promise)
  api.bind.mockRejectedValueOnce(new Error('Cannot bind Finance'))
  api.unbind.mockResolvedValueOnce({ result: 'success' })
  api.list.mockResolvedValue(rosterPage([]))
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('status', { name: 'agentRoster.roster.emptySearch' }))
    .toBeVisible()
  await expect.element(card).not.toBeInTheDocument()
  catalogRefresh.resolve([research, finance])
  await expect.element(page.getByText('Cannot bind Finance', { exact: true })).toBeVisible()
})
