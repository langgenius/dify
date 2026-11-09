import type { KnowledgeAgentMineResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { AgentConnectionsDialog } from '../agent-connections-dialog'

vi.mock('@/context/workspace-state', async () => {
  const { atom } = await import('jotai')
  return { isCurrentWorkspaceManagerAtom: atom(false) }
})

const MCP_URL = 'https://knowledge.example-company-with-a-long-domain-name.test/mcp/knowledge'

const mine: KnowledgeAgentMineResponse = {
  available: true,
  agent_access_enabled: true,
  blocked_knowledge_base_ids: [],
  mcp_url: MCP_URL,
  grants: [
    {
      id: 'grant-1',
      kind: 'personal',
      name: 'A personal token with a name long enough to need truncating in the list',
      client_name: null,
      scopes: ['knowledge:read'],
      knowledge_base_ids: ['kb-1', 'kb-2', 'kb-3', 'kb-4'],
      created_at: '2026-11-01T00:00:00Z',
      expires_at: '2026-12-01T00:00:00Z',
      last_used_at: null,
    },
  ],
}

const renderDialog = async (onOpenChange = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(consoleQuery.knowledgeFs.agentAccess.get.queryKey(), mine)
  await render(
    <QueryClientProvider client={queryClient}>
      <AgentConnectionsDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return onOpenChange
}

describe('AgentConnectionsDialog in the browser', () => {
  afterEach(async () => {
    await page.viewport(1280, 800)
  })

  it('fits a phone screen: long commands truncate inside their rows instead of widening the dialog', async () => {
    await page.viewport(390, 844)
    await renderDialog()

    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    const element = dialog.element()
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth)
    expect(element.getBoundingClientRect().width).toBeLessThanOrEqual(390)

    const command = page
      .getByText(`claude mcp add --transport http dify-knowledge ${MCP_URL}`)
      .element()
    expect(command.scrollWidth).toBeGreaterThan(command.clientWidth)
    expect(getComputedStyle(command).textOverflow).toBe('ellipsis')
  })

  it('closes with Escape', async () => {
    const onOpenChange = await renderDialog()

    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}')

    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  })
})
