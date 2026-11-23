import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { consoleClient } from '@/service/console'
import { zAgentInviteOptionsResponse } from '@dify/contracts/api/console/agent/zod.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedTags } from '@/test/console/tags'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  AgentSelectorMenu,
  AgentSelectorMenuContent,
  AgentSelectorMenuTrigger,
} from '../agent-selector'

const listAgents = vi.hoisted(() => vi.fn<typeof consoleClient.agent.inviteOptions.get>())
const longTagName = 'FinanceAndAccountingForInternationalOperations'

// boundary: the console service supplies the selectable agents for each filter and page.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.inviteOptions.get': listAgents,
    }),
  }
})

function agent(name: string): AgentInviteOptionResponse {
  return {
    id: name,
    name,
    description: '',
    agent_kind: 'dify_agent',
    scope: 'roster',
    source: 'roster',
    status: 'active',
    active_config_snapshot_id: 'snapshot',
    icon_type: 'emoji',
    icon: '🦊',
  }
}

async function openAgentSelector() {
  onTestFinished(guardUnexpectedFetch())
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['agent.tag.manage'],
  })
  seedTags(queryClient, [
    { id: 'research', name: 'Research', type: 'agent', binding_count: '2' },
    { id: 'finance', name: 'Finance', type: 'agent', binding_count: '1' },
    { id: 'support', name: 'Support', type: 'agent', binding_count: '1' },
    { id: 'international', name: longTagName, type: 'agent', binding_count: '1' },
  ])
  await render(
    <Wrapper>
      <EditorResourceScope
        resource={{
          kind: 'app',
          appId: 'workflow-1',
          mode: 'workflow',
          collaborationEnabled: false,
        }}
      >
        <AgentSelectorMenu>
          <AgentSelectorMenuTrigger openOnHover>Choose agent</AgentSelectorMenuTrigger>
          <AgentSelectorMenuContent onSelect={vi.fn()} onStartFromScratch={vi.fn()} />
        </AgentSelectorMenu>
      </EditorResourceScope>
    </Wrapper>,
  )

  await page.getByRole('button', { name: 'Choose agent' }).hover()
}

it('keeps the tag popup above the Agent avatar and both footer action icons', async () => {
  // At this width the popup shifts inside the viewport and covers the icons below it.
  const { innerWidth, innerHeight } = window
  await page.viewport(248, 700)
  onTestFinished(() => page.viewport(innerWidth, innerHeight))
  listAgents.mockResolvedValue(
    zAgentInviteOptionsResponse.parse({
      data: [agent('Fox')],
      page: 1,
      limit: 8,
      total: 1,
      has_more: false,
    }),
  )
  await openAgentSelector()

  const footerActionNames = [/startFromScratch/, /manageInAgentConsole/]
  const avatar = page.getByText('🦊')
  await expect.element(avatar).toBeVisible()
  const icons = [
    avatar.element(),
    ...footerActionNames.map((name) => {
      const action = page.getByRole('menuitem', { name }).element()
      return action.querySelector('[aria-hidden="true"]')!
    }),
  ]

  await page.getByRole('button', { name: 'common.tag.placeholder' }).click()
  const popup = page.getByRole('dialog', { name: 'common.tag.placeholder' })
  await expect.element(popup.getByRole('checkbox', { name: 'Finance', exact: true })).toBeVisible()
  for (const icon of icons) {
    const { x, y, width, height } = icon.getBoundingClientRect()
    const hit = document.elementFromPoint(x + width / 2, y + height / 2)
    expect(popup.element().contains(hit)).toBe(true)
  }
})

it('combines the workflow search and tags, pages through matching candidates and clears only tags', async () => {
  listAgents.mockImplementation(async (input) => {
    const { page = 1, limit = 8, keyword, tag_ids = [] } = input?.query ?? {}
    const candidates =
      tag_ids.length > 1
        ? []
        : tag_ids.length
          ? [agent(`Research ${page}`)]
          : [agent(keyword ? 'Company agent' : 'All agents')]
    return zAgentInviteOptionsResponse.parse({
      data: candidates,
      page,
      limit,
      total: tag_ids.length === 1 ? 2 : candidates.length,
      has_more: tag_ids.length === 1 && page === 1,
    })
  })

  await openAgentSelector()
  const search = page.getByRole('searchbox', { name: 'agentRoster.roster.searchLabel' })
  const tags = page.getByRole('button', { name: 'common.tag.placeholder' })
  await expect.element(tags).toBeVisible()
  const searchBounds = search.element().getBoundingClientRect()
  const tagBounds = tags.element().getBoundingClientRect()
  const searchCenterY = searchBounds.top + searchBounds.height / 2
  expect(searchCenterY).toBeGreaterThan(tagBounds.top)
  expect(searchCenterY).toBeLessThan(tagBounds.bottom)
  expect(searchBounds.right).toBeLessThanOrEqual(tagBounds.left)
  await search.fill('Company')
  await expect.element(page.getByRole('menuitem', { name: 'Company agent' })).toBeVisible()
  await userEvent.tab()
  await expect.element(tags).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const tagSearch = page.getByRole('searchbox', { name: 'common.tag.searchTags' })
  await expect.element(tagSearch).toHaveAttribute('placeholder', 'common.tag.searchTags')
  await tagSearch.fill('nothing matches')
  await expect.element(page.getByText('common.tag.noTag')).toBeVisible()
  await tagSearch.fill('res')
  const researchOption = page.getByRole('checkbox', { name: 'Research' })
  await expect.element(page.getByRole('checkbox', { name: 'Support' })).not.toBeInTheDocument()
  await userEvent.tab()
  await expect.element(researchOption).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(researchOption).toBeChecked()
  await expect
    .element(page.getByRole('button', { name: 'common.tag.manageTags' }))
    .not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await page.getByRole('menuitem', { name: 'agentRoster.roster.loadMore' }).click()
  await expect.element(page.getByRole('menuitem', { name: 'Research 2' })).toBeVisible()
  await expect.element(page.getByRole('menuitem', { name: 'Research 1' })).toBeVisible()
  expect(listAgents).toHaveBeenLastCalledWith({
    query: { app_id: 'workflow-1', keyword: 'Company', limit: 8, page: 2, tag_ids: ['research'] },
  })

  const selectedTag = page.getByRole('button', { name: 'Research', exact: true })
  await expect.element(selectedTag).toHaveTextContent('Research')
  await selectedTag.click()
  await tagSearch.fill('')
  await page.getByRole('checkbox', { name: 'Finance', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('status')).toHaveTextContent('agentRoster.roster.emptySearch')
  expect(listAgents).toHaveBeenLastCalledWith({
    query: {
      app_id: 'workflow-1',
      keyword: 'Company',
      limit: 8,
      page: 1,
      tag_ids: ['research', 'finance'],
    },
  })

  const twoTags = page.getByRole('button', { name: 'Research, Finance', exact: true })
  await expect.element(twoTags.getByText(/^Research,\s*Finance$/)).toBeVisible()
  await twoTags.click()
  await page.getByRole('checkbox', { name: 'Finance', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menuitem', { name: 'Research 1' })).toBeVisible()
  await expect
    .element(page.getByRole('menuitem', { name: 'agentRoster.roster.loadMore' }))
    .toBeVisible()
  await expect.element(page.getByRole('menuitem', { name: 'Research 2' })).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'common.operation.clear' }).click()
  await expect.element(page.getByRole('menuitem', { name: 'Company agent' })).toBeVisible()
  await expect.element(search).toHaveValue('Company')
})

it('bounds long tag summaries and keeps the additional count and clear button visible', async () => {
  listAgents.mockResolvedValue(
    zAgentInviteOptionsResponse.parse({ data: [], page: 1, limit: 8, total: 0, has_more: false }),
  )
  await openAgentSelector()
  await page.getByRole('button', { name: 'common.tag.placeholder' }).click()
  for (const name of [longTagName, 'Research', 'Support']) {
    await page.getByRole('checkbox', { name, exact: true }).click()
  }
  await userEvent.keyboard('{Escape}')

  const summary = page.getByRole('button', { name: `${longTagName}, Research, Support` })
  const names = summary.getByText(new RegExp(`^${longTagName},\\s*Research$`))
  await expect.element(summary.getByText('+1', { exact: true })).toBeVisible()
  expect(names.element().scrollWidth).toBeGreaterThan(names.element().clientWidth)
  const chip = summary.element().getBoundingClientRect()
  expect(chip.width).toBeLessThanOrEqual(128)
  const search = page.getByRole('searchbox', { name: 'agentRoster.roster.searchLabel' })
  expect(search.element().getBoundingClientRect().right).toBeLessThanOrEqual(chip.left)
  await search.fill('Company')
  await page.getByRole('button', { name: 'common.operation.clear' }).click()
  await expect.element(search).toHaveValue('Company')
  await expect.element(page.getByRole('button', { name: 'common.tag.placeholder' })).toHaveFocus()
})
