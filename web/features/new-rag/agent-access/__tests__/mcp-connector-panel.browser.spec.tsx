import type { KnowledgeAgentMineResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { McpConnectorPanel } from '../mcp-connector-panel'

// boundary: the workspace role comes from the app shell; a member sees no workspace section.
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
      token_hint: 'V3q6',
    },
  ],
}

const renderPanel = async (onOpenChange = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(consoleQuery.knowledgeFs.agentAccess.get.queryKey(), mine)
  // The panel names each connection's knowledge bases; none are loaded, so it shows counts.
  queryClient.setQueryData(
    consoleQuery.knowledgeFs.spaces.get.infiniteKey({
      input: (page: number) => ({ query: { limit: 100, page } }),
      initialPageParam: 1,
    }),
    { pages: [{ data: [], has_more: false, limit: 100, page: 1 }], pageParams: [1] },
  )
  await render(
    <QueryClientProvider client={queryClient}>
      <McpConnectorPanel open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return onOpenChange
}

describe('McpConnectorPanel in the browser', () => {
  afterEach(async () => {
    await page.viewport(1280, 800)
  })

  it('fits a phone screen: long commands and names truncate instead of widening the panel', async () => {
    await page.viewport(390, 844)
    await renderPanel()

    const panel = page.getByRole('dialog')
    await expect.element(panel).toBeVisible()
    const element = panel.element()
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth)
    expect(element.getBoundingClientRect().width).toBeLessThanOrEqual(390)

    const command = page.getByText(`claude mcp add --transport http knowledge ${MCP_URL}`).element()
    expect(command.scrollWidth).toBeGreaterThan(command.clientWidth)
    expect(getComputedStyle(command).textOverflow).toBe('ellipsis')
    // The row's actions stay reachable next to a name that does not fit.
    await expect
      .element(page.getByRole('button', { name: /agents\.deleteNamedToken/ }))
      .toBeInViewport()
  })

  it('opens beside the page at desktop width and closes with Escape', async () => {
    await page.viewport(1280, 800)
    const onOpenChange = await renderPanel()

    const panel = page.getByRole('dialog')
    await expect.element(panel).toBeVisible()
    const box = panel.element().getBoundingClientRect()
    expect(box.width).toBe(600)
    expect(Math.round(box.right)).toBe(1280)
    await userEvent.keyboard('{Escape}')

    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  })
})
