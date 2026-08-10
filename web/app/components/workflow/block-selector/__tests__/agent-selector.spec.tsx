import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { AgentSelectorContent } from '../agent-selector'

const mocks = vi.hoisted(() => ({
  canManageAgents: true,
  agents: [] as AgentInviteOptionResponse[],
}))

vi.mock('@/features/agent-v2/permissions', () => ({
  useCanManageAgents: () => mocks.canManageAgents,
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: () => undefined,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      inviteOptions: {
        get: {
          queryOptions: () => ({
            queryKey: ['agent-invite-options'],
            queryFn: async () => ({ data: mocks.agents }),
          }),
        },
      },
    },
  },
}))

const manageInConsoleLabel = /manageInAgentConsole/
const startFromScratchLabel = /startFromScratch/

const renderSelector = async ({ onStartFromScratch }: { onStartFromScratch?: () => void } = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <AgentSelectorContent
        open
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        onStartFromScratch={onStartFromScratch}
      />
    </QueryClientProvider>,
  )

  await screen.findByRole('listbox')
}

describe('AgentSelectorContent', () => {
  beforeEach(() => {
    mocks.canManageAgents = true
    mocks.agents = []
  })

  it('offers the Agent Console link with agent.manage', async () => {
    await renderSelector()

    expect(screen.getByText(manageInConsoleLabel)).toBeInTheDocument()
  })

  it('hides the Agent Console link without agent.manage', async () => {
    mocks.canManageAgents = false

    await renderSelector()

    expect(screen.queryByText(manageInConsoleLabel)).not.toBeInTheDocument()
  })

  it('keeps start from scratch without agent.manage', async () => {
    mocks.canManageAgents = false

    await renderSelector({ onStartFromScratch: vi.fn() })

    expect(screen.getByText(startFromScratchLabel)).toBeInTheDocument()
    expect(screen.queryByText(manageInConsoleLabel)).not.toBeInTheDocument()
  })

  it('renders no action row when neither action is available', async () => {
    mocks.canManageAgents = false

    await renderSelector()

    expect(screen.queryByText(startFromScratchLabel)).not.toBeInTheDocument()
    expect(screen.queryByText(manageInConsoleLabel)).not.toBeInTheDocument()
  })

  it('renders uploaded image icons using icon_url', async () => {
    mocks.agents = [
      {
        id: 'agent-1',
        name: 'Image Agent',
        description: 'Uses uploaded icon',
        active_config_snapshot_id: 'version-1',
        icon: '29bdb007-4d8c-4888-83a2-7587abcafb26',
        icon_background: '#F5F3FF',
        icon_type: 'image',
        icon_url: '/files/29bdb007-4d8c-4888-83a2-7587abcafb26/file-preview?sign=abc',
        role: 'Analyst',
        agent_kind: 'dify_agent',
        scope: 'roster',
        source: 'agent_app',
        status: 'active',
      },
    ]

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AgentSelectorContent open onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>,
    )

    await screen.findByText('Image Agent')

    expect(container.querySelector('img[alt="app icon"]')).toHaveAttribute(
      'src',
      '/files/29bdb007-4d8c-4888-83a2-7587abcafb26/file-preview?sign=abc',
    )
  })
})
