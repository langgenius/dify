import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const renderSelector = async ({
  onOpenChange = vi.fn(),
  onStartFromScratch,
}: {
  onOpenChange?: (open: boolean) => void
  onStartFromScratch?: () => void
} = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <AgentSelectorContent
        open
        onOpenChange={onOpenChange}
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
    await renderSelector({ onStartFromScratch: vi.fn() })

    const listbox = screen.getByRole('listbox')
    const startButton = screen.getByRole('button', { name: startFromScratchLabel })
    const manageLink = screen.getByRole('link', { name: manageInConsoleLabel })

    expect(manageLink).toHaveAttribute('href', '/agents')
    expect(listbox).not.toContainElement(manageLink)
    expect(startButton).toHaveClass(
      'h-7',
      'rounded-md',
      'px-2',
      'py-1.5',
      'system-sm-regular',
      'text-text-secondary',
    )
    expect(manageLink).toHaveClass(
      'h-7',
      'rounded-md',
      'px-2',
      'py-1.5',
      'system-sm-regular',
      'text-text-secondary',
    )
  })

  it('should keep the listbox as the only scroll owner for agent options', async () => {
    await renderSelector()

    const listbox = screen.getByRole('listbox')

    expect(listbox).toHaveClass('max-h-54', 'overflow-y-auto', 'outline-hidden')
    expect(listbox.querySelector('.overflow-y-auto')).not.toBeInTheDocument()
  })

  it('hides the Agent Console link without agent.manage', async () => {
    mocks.canManageAgents = false

    await renderSelector()

    expect(screen.queryByText(manageInConsoleLabel)).not.toBeInTheDocument()
  })

  it('keeps start from scratch without agent.manage', async () => {
    mocks.canManageAgents = false

    await renderSelector({ onStartFromScratch: vi.fn() })

    const listbox = screen.getByRole('listbox')
    const startButton = screen.getByRole('button', { name: startFromScratchLabel })

    expect(listbox).not.toContainElement(startButton)
    expect(screen.queryByText(manageInConsoleLabel)).not.toBeInTheDocument()
  })

  it('should move focus from the combobox to actions outside the listbox', async () => {
    const user = userEvent.setup()
    await renderSelector({ onStartFromScratch: vi.fn() })

    const input = screen.getByRole('combobox')
    const startButton = screen.getByRole('button', { name: startFromScratchLabel })
    const listbox = screen.getByRole('listbox')

    expect(listbox).not.toContainElement(startButton)
    input.focus()
    await user.tab()

    expect(startButton).toHaveFocus()
  })

  it('does not dismiss the combobox when pressing a footer action', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onStartFromScratch = vi.fn()
    await renderSelector({ onOpenChange, onStartFromScratch })

    const startButton = screen.getByRole('button', { name: startFromScratchLabel })

    await user.pointer({ keys: '[MouseLeft>]', target: startButton })

    expect(onOpenChange).not.toHaveBeenCalled()

    await user.pointer({ keys: '[/MouseLeft]', target: startButton })

    expect(onStartFromScratch).toHaveBeenCalledOnce()
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
