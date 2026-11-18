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

  await page.getByRole('combobox', { name: 'common.tag.placeholder' }).click()
  const popup = page.getByRole('dialog', { name: 'common.tag.placeholder' })
  await expect.element(popup.getByRole('option', { name: 'Finance' })).toBeVisible()
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
  const search = page.getByRole('searchbox')
  await search.fill('Company')
  await expect.element(page.getByRole('menuitem', { name: 'Company agent' })).toBeVisible()
  await userEvent.tab()
  const tags = page.getByRole('combobox', { name: 'common.tag.placeholder' })
  await expect.element(tags).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await page.getByRole('option', { name: 'Research' }).click()
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

  await page.getByRole('combobox', { name: 'Research' }).click()
  await page.getByRole('option', { name: 'Finance' }).click()
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

  await page.getByRole('combobox', { name: 'Research, Finance' }).click()
  await page.getByRole('option', { name: 'Finance' }).click()
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
