import type { AgentRosterNodeData } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AgentSelectorMenu,
  AgentSelectorMenuContent,
  AgentSelectorMenuTrigger,
} from '../agent-selector'

const mocks = vi.hoisted(() => ({
  agents: [] as Array<Record<string, unknown>>,
  queryOptions: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: () => undefined,
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => null,
}))

vi.mock('@/app/notifications', () => ({
  toast: { error: mocks.toastError },
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    agent: {
      inviteOptions: {
        get: {
          queryOptions: (args: unknown) => {
            mocks.queryOptions(args)
            return {
              queryKey: ['agent-invite-options', args],
              queryFn: async () => ({ data: mocks.agents }),
            }
          },
        },
      },
    },
  },
}))

const createAgent = (overrides: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  name: 'Zoe',
  description: 'Research assistant',
  role: 'Researcher',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFFFFF',
  active_config_snapshot_id: 'snapshot-1',
  ...overrides,
})

const renderMenu = async ({
  onSelect = vi.fn<(agent: AgentRosterNodeData) => void>(),
  onStartFromScratch,
}: {
  onSelect?: ReturnType<typeof vi.fn<(agent: AgentRosterNodeData) => void>>
  onStartFromScratch?: () => void
} = {}) => {
  const user = userEvent.setup()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <AgentSelectorMenu>
        <AgentSelectorMenuTrigger>Open agents</AgentSelectorMenuTrigger>
        <AgentSelectorMenuContent onSelect={onSelect} onStartFromScratch={onStartFromScratch} />
      </AgentSelectorMenu>
    </QueryClientProvider>,
  )

  await user.click(screen.getByRole('button', { name: 'Open agents' }))
  const menu = await screen.findByRole('menu')

  return { user, menu, onSelect }
}

describe('AgentSelectorMenu', () => {
  beforeEach(() => {
    mocks.agents = []
    mocks.queryOptions.mockClear()
    mocks.toastError.mockClear()
  })

  it('lists agents and keeps the footer actions inside the menu', async () => {
    mocks.agents = [createAgent(), createAgent({ id: 'agent-2', name: 'Bob' })]
    const { menu } = await renderMenu({ onStartFromScratch: vi.fn() })

    expect(await within(menu).findByRole('menuitem', { name: /Zoe/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Bob/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /startFromScratch/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /manageInAgentConsole/ })).toHaveAttribute(
      'href',
      '/agents',
    )
  })

  it('sends the typed keyword to the agent search', async () => {
    const { user } = await renderMenu()

    await user.type(screen.getByRole('searchbox'), 'zo')

    await waitFor(() => {
      expect(mocks.queryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { query: expect.objectContaining({ keyword: 'zo' }) },
        }),
      )
    })
  })

  it('reports the chosen agent as roster node data and closes', async () => {
    mocks.agents = [createAgent()]
    const { user, menu, onSelect } = await renderMenu()

    await user.click(await within(menu).findByRole('menuitem', { name: /Zoe/ }))

    expect(onSelect).toHaveBeenCalledWith({
      description: 'Research assistant',
      icon: '🤖',
      icon_background: '#FFFFFF',
      icon_type: 'emoji',
      id: 'agent-1',
      name: 'Zoe',
      role: 'Researcher',
    })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('keeps the menu open and reports an agent without an active configuration', async () => {
    mocks.agents = [createAgent({ active_config_snapshot_id: null })]
    const { user, menu, onSelect } = await renderMenu()

    await user.click(await within(menu).findByRole('menuitem', { name: /Zoe/ }))

    expect(mocks.toastError).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('keeps a loading trigger focusable without opening the menu', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <AgentSelectorMenu>
          <AgentSelectorMenuContent onSelect={vi.fn()} />
          <AgentSelectorMenuTrigger render={<Button loading />}>
            Open agents
          </AgentSelectorMenuTrigger>
        </AgentSelectorMenu>
      </QueryClientProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Open agents' })
    expect(trigger).toHaveAttribute('aria-disabled', 'true')
    expect(trigger).not.toHaveAttribute('disabled')

    await user.tab()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('reaches the footer actions with the arrow keys', async () => {
    mocks.agents = [createAgent()]
    const { user, menu } = await renderMenu({ onStartFromScratch: vi.fn() })
    await within(menu).findByRole('menuitem', { name: /Zoe/ })

    await user.keyboard('{ArrowDown}{ArrowDown}')

    expect(within(menu).getByRole('menuitem', { name: /startFromScratch/ })).toHaveAttribute(
      'data-highlighted',
    )
  })
})
