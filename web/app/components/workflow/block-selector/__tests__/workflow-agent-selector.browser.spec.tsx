import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ExternalAgentListResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { ComponentProps } from 'react'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { NodeDefault } from '@/app/components/workflow/types'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { BlockEnum } from '@/app/components/workflow/types'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { createExternalAgentAsset } from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { AgentBlockItem } from '../agent-selector'
import { BlockClassification } from '../types'

const difyAgent: AgentInviteOptionResponse = {
  id: 'dify-agent-1',
  name: 'Research Agent',
  description: 'Researches public information.',
  role: 'Researcher',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFFFFF',
  active_config_snapshot_id: 'snapshot-1',
  agent_kind: 'dify_agent',
  scope: 'roster',
  source: 'workflow',
  status: 'active',
}

const mocks = vi.hoisted(() => ({
  fetchAgents: vi.fn(),
  fetchExternal: vi.fn<typeof import('@/service/console').consoleClient.externalAgents.get>(),
}))
// boundary: restore real translations so this fixture's I18nextProvider supplies rendered labels.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: Dify invite options are server data; source filtering and selection remain real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { createExternalAgentCapabilities } = await import('@/test/console/external-agents')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'tags.get': () =>
        ['Research', 'Finance', 'Support', 'Sales', 'Design', 'Operations', 'Writing'].map(
          (name) => ({
            id: name.toLowerCase(),
            name,
            type: 'agent',
          }),
        ),
      'externalAgents.get': mocks.fetchExternal,
      'externalAgents.capabilities.get': () => createExternalAgentCapabilities(),
      'agent.inviteOptions.get': (
        input: Parameters<typeof actual.consoleClient.agent.inviteOptions.get>[0],
      ) => {
        mocks.fetchAgents(input)
        const keyword = input?.query?.keyword?.toLowerCase() ?? ''
        const data = [difyAgent].filter((agent) => agent.name.toLowerCase().includes(keyword))
        const page = input?.query?.page ?? 1
        if (input?.query?.tag_ids?.includes('research')) {
          return {
            data: [{ ...difyAgent, id: `match-${page}`, name: `Research match ${page}` }],
            has_more: page === 1,
            limit: 8,
            page,
            total: 2,
          }
        }
        return { data, has_more: false, limit: 8, page, total: data.length }
      },
    }),
  }
})

const block: NodeDefault = {
  metaData: {
    classification: BlockClassification.Default,
    sort: 3,
    type: BlockEnum.AgentV2,
    title: 'Agent',
    author: 'Dify',
    description: 'Call an agent.',
  },
  defaultValue: {},
  checkValid: () => ({ isValid: true }),
}

type AgentBlockProps = ComponentProps<typeof AgentBlockItem>

async function setup(
  resource: EditorResource = {
    kind: 'app',
    collaborationEnabled: false,
    appId: 'workflow-app',
    mode: 'workflow',
  },
) {
  await page.viewport(1100, 750)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common, navigation, workflow } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  onTestFinished(() => queryClient.clear())
  const onSelect = vi.fn<AgentBlockProps['onSelect']>()
  const onSelectExternal = vi.fn<NonNullable<AgentBlockProps['onSelectExternal']>>()
  const onStartFromScratch = vi.fn()
  await render(
    <QueryProvider>
      <EditorResourceScope resource={resource}>
        <I18nextProvider i18n={i18n}>
          <div className="isolate w-60 p-4">
            <AgentBlockItem
              block={block}
              onSelect={onSelect}
              onSelectExternal={onSelectExternal}
              onStartFromScratch={onStartFromScratch}
            />
          </div>
        </I18nextProvider>
      </EditorResourceScope>
    </QueryProvider>,
  )
  const trigger = page.getByRole('button', { name: /^Agent/ })
  await trigger.click()
  const picker = page.getByRole('dialog', { name: 'Select an agent', exact: true })
  await expect.element(picker).toBeVisible()
  return { picker, trigger, onSelect, onSelectExternal, onStartFromScratch }
}

beforeEach(({ onTestFinished }) => {
  mocks.fetchAgents.mockClear()
  mocks.fetchExternal.mockReset().mockImplementation(async (input) => {
    const items = [
      createExternalAgentAsset({ tags: [{ id: 'research', name: 'Research', type: 'agent' }] }),
      createExternalAgentAsset({
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Document Review Agent',
        tags: [
          { id: 'research', name: 'Research', type: 'agent' },
          { id: 'finance', name: 'Finance', type: 'agent' },
        ],
      }),
      createExternalAgentAsset({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Invoice Audit Agent',
        enabled: false,
      }),
    ].filter(
      (agent) =>
        (!input?.query?.keyword ||
          agent.name.toLowerCase().includes(input.query.keyword.toLowerCase())) &&
        (input?.query?.tag_ids ?? []).every((id) => agent.tags.some((tag) => tag.id === id)),
    )
    return {
      items,
      total: items.length,
      enabled_count: items.filter((agent) => agent.enabled).length,
      disabled_count: items.filter((agent) => !agent.enabled).length,
      limit: input?.query?.limit ?? 20,
      page: input?.query?.page ?? 1,
    }
  })
  onTestFinished(guardUnexpectedFetch())
})

it('filters the active source while sharing the search and avoiding Dify requests on External', async () => {
  const { picker } = await setup()
  const search = picker.getByRole('searchbox', { name: 'Search agents', exact: true })
  await expect
    .element(picker.getByRole('tab', { name: 'All', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(picker.getByRole('button', { name: /Research Agent/ })).toBeVisible()
  await expect.element(picker.getByRole('button', { name: /Contract Review Agent/ })).toBeVisible()
  await picker.getByRole('tab', { name: 'External', exact: true }).click()
  await expect
    .element(picker.getByRole('button', { name: /Research Agent/ }))
    .not.toBeInTheDocument()
  await expect
    .element(picker.getByRole('button', { name: 'Start from Scratch', exact: true }))
    .not.toBeInTheDocument()
  const requests = mocks.fetchAgents.mock.calls.length
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  await search.fill('document')
  await expect.element(search).toHaveValue('document')
  await vi.advanceTimersByTimeAsync(300)
  await expect.element(picker.getByRole('button', { name: /Document Review Agent/ })).toBeVisible()
  await expect
    .element(picker.getByRole('button', { name: /Contract Review Agent/ }))
    .not.toBeInTheDocument()
  expect(mocks.fetchAgents).toHaveBeenCalledTimes(requests)
  vi.useRealTimers()

  await picker.getByRole('tab', { name: 'Dify', exact: true }).click()
  await expect
    .poll(() => mocks.fetchAgents.mock.calls.at(-1))
    .toEqual([{ query: { app_id: 'workflow-app', limit: 8, page: 1, keyword: 'document' } }])
  await expect.element(search).toHaveValue('document')
  await expect.element(picker.getByText('No matching agents', { exact: true })).toBeVisible()
  await picker.getByRole('tab', { name: 'All', exact: true }).click()
  await expect.element(picker.getByRole('button', { name: /Document Review Agent/ })).toBeVisible()
})

it('keeps external agents visible while a new search is pending', async () => {
  const { picker } = await setup()
  const previousAgent = picker.getByRole('button', { name: /Contract Review Agent/ })
  await expect.element(previousAgent).toBeVisible()

  const response = createDeferred<ExternalAgentListResponse>()
  mocks.fetchExternal.mockImplementationOnce(() => response.promise)
  await picker.getByRole('searchbox', { name: 'Search agents', exact: true }).fill('document')
  await expect
    .poll(() => mocks.fetchExternal.mock.lastCall?.[0])
    .toEqual({ query: { page: 1, limit: 20, keyword: 'document' } })
  await expect.element(previousAgent).toBeVisible()

  response.resolve({
    items: [
      createExternalAgentAsset({
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Document Review Agent',
      }),
    ],
    total: 1,
    enabled_count: 1,
    disabled_count: 0,
    limit: 20,
    page: 1,
  })
  await expect.element(previousAgent).not.toBeInTheDocument()
  await expect.element(picker.getByRole('button', { name: /Document Review Agent/ })).toBeVisible()
})

it('shows the All search empty state only after both sources return no matches', async () => {
  const { picker } = await setup()
  const search = picker.getByRole('searchbox', { name: 'Search agents', exact: true })
  const difyAgent = picker.getByRole('button', { name: /Research Agent/ })
  const externalAgent = picker.getByRole('button', { name: /Contract Review Agent/ })
  const emptyState = picker
    .getByRole('status')
    .filter({ hasText: /^No (agent yet|matching agents)$/ })
  await expect.element(externalAgent).toBeVisible()

  await search.fill('research')
  await expect.element(externalAgent).not.toBeInTheDocument()
  await expect.element(difyAgent).toBeVisible()
  await expect.element(emptyState).not.toBeInTheDocument()

  const response = createDeferred<ExternalAgentListResponse>()
  mocks.fetchExternal.mockImplementationOnce(() => response.promise)
  await search.fill('unmatched')
  await expect.element(difyAgent).not.toBeInTheDocument()
  await expect.element(emptyState).not.toBeInTheDocument()

  response.resolve({ items: [], total: 0, enabled_count: 0, disabled_count: 0, limit: 20, page: 1 })
  await expect.element(emptyState).toHaveTextContent('No matching agents')
})

it('skips disabled external agents during keyboard selection and closes with the external callback', async () => {
  const { picker, onSelect, onSelectExternal } = await setup()
  await picker.getByRole('tab', { name: 'External', exact: true }).click()
  const contract = picker.getByRole('button', { name: /Contract Review Agent/ })
  const document = picker.getByRole('button', { name: /Document Review Agent/ })
  await expect.element(picker.getByRole('button', { name: /Invoice Audit Agent/ })).toBeDisabled()
  await userEvent.tab()
  await expect
    .element(picker.getByRole('tabpanel', { name: 'External', exact: true }))
    .toHaveFocus()
  await userEvent.tab()
  await expect.element(contract).toHaveFocus()
  await userEvent.tab()
  await expect.element(document).toHaveFocus()
  await userEvent.tab()
  const manage = picker.getByRole('link', { name: 'Manage in Agents', exact: true })
  await expect.element(manage).toHaveFocus()
  await expect.element(manage).toHaveAttribute('href', '/agents')
  await userEvent.tab({ shift: true })
  await expect.element(document).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => onSelectExternal.mock.calls)
    .toEqual([
      [
        expect.objectContaining({
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Document Review Agent',
        }),
      ],
    ])
  expect(onSelect).not.toHaveBeenCalled()
  await expect.element(picker).not.toBeInTheDocument()
})

it('keeps Dify selection and starting from scratch as distinct actions', async () => {
  const { picker, trigger, onSelect, onSelectExternal, onStartFromScratch } = await setup()
  await picker.getByRole('button', { name: /Research Agent/ }).click()
  await expect
    .poll(() => onSelect.mock.calls)
    .toEqual([
      [
        {
          description: difyAgent.description,
          icon: difyAgent.icon,
          icon_background: difyAgent.icon_background,
          icon_type: difyAgent.icon_type,
          id: difyAgent.id,
          name: difyAgent.name,
          role: difyAgent.role,
        },
      ],
    ])
  expect(onSelectExternal).not.toHaveBeenCalled()
  await expect.element(picker).not.toBeInTheDocument()
  await trigger.click()
  await picker.getByRole('button', { name: 'Start from Scratch', exact: true }).click()
  expect(onStartFromScratch).toHaveBeenCalledOnce()
  expect(onSelect).toHaveBeenCalledOnce()
  await expect.element(picker).not.toBeInTheDocument()
})

it('resets the source and search when closing and reopening the picker', async () => {
  const { picker, trigger } = await setup()
  await picker.getByRole('tab', { name: 'External', exact: true }).click()
  await picker.getByRole('searchbox', { name: 'Search agents', exact: true }).fill('contract')
  await expect
    .element(picker.getByRole('button', { name: /Document Review Agent/ }))
    .not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(picker.getByRole('searchbox', { name: 'Search agents', exact: true }))
    .toHaveValue('')
  await userEvent.keyboard('{Escape}')
  await expect.element(picker).not.toBeInTheDocument()
  await trigger.click()
  await expect
    .element(picker.getByRole('tab', { name: 'All', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(picker.getByRole('searchbox', { name: 'Search agents', exact: true }))
    .toHaveValue('')
  await expect.element(picker.getByRole('button', { name: /Research Agent/ })).toBeVisible()
  await expect.element(picker.getByRole('button', { name: /Document Review Agent/ })).toBeVisible()
})

it('keeps external previews out of snippet selection and omits the workflow app filter', async () => {
  const { picker } = await setup({ kind: 'snippet', snippetId: 'snippet-1' })
  await expect
    .element(picker.getByRole('tab', { name: 'External', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(picker.getByRole('button', { name: /Contract Review Agent/ }))
    .not.toBeInTheDocument()
  await expect
    .poll(() => mocks.fetchAgents.mock.calls.at(-1))
    .toEqual([{ query: { limit: 8, page: 1 } }])
})

it('loads another server page before selecting an external agent outside the first page', async () => {
  const later = createExternalAgentAsset({
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Later page Agent',
  })
  mocks.fetchExternal.mockImplementation(async (input) => ({
    items: input?.query?.page === 2 ? [later] : [createExternalAgentAsset()],
    total: 2,
    enabled_count: 2,
    disabled_count: 0,
    page: input?.query?.page ?? 1,
    limit: 1,
  }))
  const { picker, onSelectExternal } = await setup()
  await picker.getByRole('tab', { name: 'External', exact: true }).click()
  await picker.getByRole('button', { name: 'Load more agents', exact: true }).click()
  await expect.element(picker.getByRole('button', { name: /Later page Agent/ })).toBeVisible()
  expect(mocks.fetchExternal).toHaveBeenLastCalledWith({ query: { page: 2, limit: 20 } })
  await picker.getByRole('button', { name: /Later page Agent/ }).click()
  expect(onSelectExternal).toHaveBeenCalledWith(later)
})

it('keeps the tag popup above Dify results and pages through tagged agents in All', async () => {
  const { picker } = await setup()
  await picker.getByRole('tab', { name: 'Dify', exact: true }).click()
  const candidate = picker.getByRole('button', { name: /Research Agent/ })
  await expect.element(candidate).toBeVisible()
  const tagFilter = picker.getByRole('button', { name: 'Tags', exact: true })
  const searchBounds = picker
    .getByRole('searchbox', { name: 'Search agents' })
    .element()
    .getBoundingClientRect()
  const tagBounds = tagFilter.element().getBoundingClientRect()
  const searchCenterY = searchBounds.top + searchBounds.height / 2
  expect(searchCenterY).toBeGreaterThan(tagBounds.top)
  expect(searchCenterY).toBeLessThan(tagBounds.bottom)
  expect(searchBounds.right).toBeLessThanOrEqual(tagBounds.left)
  await tagFilter.click()
  const popup = page.getByRole('dialog', { name: 'Tags', exact: true })
  const option = popup.getByRole('checkbox', { name: 'Research', exact: true })
  await expect.element(option).toBeVisible()
  const start = picker.getByRole('button', { name: 'Start from Scratch' })
  const popupBounds = popup.element().getBoundingClientRect()
  for (const underlyingRow of [candidate, start]) {
    const rowBounds = underlyingRow.element().getBoundingClientRect()
    const left = Math.max(popupBounds.left, rowBounds.left)
    const right = Math.min(popupBounds.right, rowBounds.right)
    const top = Math.max(popupBounds.top, rowBounds.top)
    const bottom = Math.min(popupBounds.bottom, rowBounds.bottom)
    expect(right).toBeGreaterThan(left)
    expect(bottom).toBeGreaterThan(top)
    const frontElement = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    expect(popup.element().contains(frontElement)).toBe(true)
  }
  await option.click()
  await userEvent.keyboard('{Escape}')
  await picker.getByRole('tab', { name: 'All', exact: true }).click()
  await expect.element(picker.getByRole('button', { name: /Research match 1/ })).toBeVisible()
  await expect.element(picker.getByRole('button', { name: /Contract Review Agent/ })).toBeVisible()
  expect(mocks.fetchExternal).toHaveBeenLastCalledWith({
    query: { page: 1, limit: 20, tag_ids: ['research'] },
  })
  await picker.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect.element(picker.getByRole('button', { name: /Research match 2/ })).toBeVisible()
  expect(mocks.fetchAgents).toHaveBeenLastCalledWith({
    query: { app_id: 'workflow-app', tag_ids: ['research'], page: 2, limit: 8 },
  })
  await picker.getByRole('button', { name: 'Research', exact: true }).click()
  await popup.getByRole('checkbox', { name: 'Finance', exact: true }).click()
  await popup.getByRole('checkbox', { name: 'Support', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  const selectedTags = picker.getByRole('button', {
    name: 'Research, Finance, Support',
    exact: true,
  })
  await expect.element(selectedTags).toHaveTextContent('Research,Finance+1')
  await expect
    .poll(() => mocks.fetchAgents.mock.calls.at(-1))
    .toEqual([
      {
        query: {
          app_id: 'workflow-app',
          tag_ids: ['research', 'finance', 'support'],
          page: 1,
          limit: 8,
        },
      },
    ])
  await picker.getByRole('tab', { name: 'External', exact: true }).click()
  await expect
    .element(picker.getByRole('button', { name: /Contract Review Agent/ }))
    .not.toBeInTheDocument()
  await expect.element(selectedTags).toBeVisible()
  expect(mocks.fetchExternal).toHaveBeenLastCalledWith({
    query: { page: 1, limit: 20, tag_ids: ['research', 'finance', 'support'] },
  })
})
