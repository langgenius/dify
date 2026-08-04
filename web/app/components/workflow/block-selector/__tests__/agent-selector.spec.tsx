import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { AgentSelectorContent } from '../agent-selector'

const mocks = vi.hoisted(() => ({
  canManageAgents: true,
  agents: [] as Array<{ id: string; name: string }>,
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
})
