import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentDetailSection, AgentDetailTop } from '../navigation'

const mocks = vi.hoisted(() => ({
  deleteAgent: vi.fn(),
  exportAppDsl: vi.fn(),
  pathname: '/agents/agent-1/configure',
  queryData: undefined as AgentAppDetailWithSite | undefined,
  replace: vi.fn(),
}))

vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => ({
    exportAppDsl: mocks.exportAppDsl,
    isExporting: false,
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useQuery: () => ({
      data: mocks.queryData,
      isPending: !mocks.queryData,
    }),
  }
})

vi.mock('@/next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    back: vi.fn(),
    replace: mocks.replace,
  }),
}))

vi.mock('@/app/components/app-sidebar/nav-link', () => ({
  default: ({ href, name }: { href: string; name: string }) => <a href={href}>{name}</a>,
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        get: {
          queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
            'agent-detail',
            input.params.agent_id,
          ],
          queryOptions: () => ({ queryKey: ['agent-detail'] }),
        },
        copy: {
          post: {
            mutationOptions: () => ({
              mutationFn: vi.fn(),
            }),
          },
        },
        delete: {
          mutationOptions: () => ({
            mutationFn: mocks.deleteAgent,
          }),
        },
        put: {
          mutationOptions: () => ({
            mutationFn: vi.fn(),
          }),
        },
      },
    },
  },
}))

const createAgent = (overrides: Partial<AgentAppDetailWithSite> = {}): AgentAppDetailWithSite => ({
  app_id: 'app-1',
  description: 'Find and summarize market materials.',
  enable_api: true,
  enable_site: true,
  icon: '🧪',
  icon_background: '#E0F2FE',
  icon_type: 'emoji',
  id: 'agent-1',
  icon_url: null,
  mode: 'agent',
  name: 'Research Agent',
  role: 'Research Assistant',
  ...overrides,
})

function renderAgentDetailSection(expand = true) {
  const queryClient = new QueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentDetailSection expand={expand} />
    </QueryClientProvider>,
  )
}

describe('AgentDetailSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteAgent.mockResolvedValue({})
    mocks.exportAppDsl.mockResolvedValue(undefined)
    mocks.pathname = '/agents/agent-1/configure'
    mocks.queryData = createAgent()
  })

  it('renders the current agent avatar, name, and role', () => {
    const { container } = renderAgentDetailSection()
    const agentName = screen.getByText('Research Agent')
    const agentAvatar = container.querySelector('em-emoji')?.parentElement

    expect(agentName).toBeInTheDocument()
    expect(screen.getByText('Research Assistant')).toBeInTheDocument()
    expect(screen.queryByText('agent')).not.toBeInTheDocument()
    expect(screen.queryByText('agentV2.agentDetail.title')).not.toBeInTheDocument()
    expect(container.querySelector('em-emoji')).toHaveAttribute('id', '🧪')
    expect(agentAvatar).toHaveClass('h-10', 'w-10', 'rounded-full')
    expect(agentAvatar?.parentElement?.parentElement).toHaveClass('mr-2')
    expect(agentName.parentElement?.parentElement).toHaveClass('h-10')
    expect(agentName.parentElement?.parentElement?.parentElement).toHaveClass(
      'h-13',
      'py-1.5',
      'pl-1.5',
      'pr-2',
    )
  })

  it('renders compact more actions beside the expanded sidebar agent identity', async () => {
    const user = userEvent.setup()
    renderAgentDetailSection()

    const trigger = screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ })
    expect(trigger).toHaveClass('size-6')
    expect(trigger).toHaveClass('hover:bg-state-base-hover')

    await user.click(trigger)

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'agentV2.roster.editInfo',
      'common.operation.duplicate',
      'app.export',
      'common.operation.delete',
    ])
  })

  it('exports the Agent App DSL from the detail action menu', async () => {
    const user = userEvent.setup()
    renderAgentDetailSection()

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'app.export' }))

    expect(mocks.exportAppDsl).toHaveBeenCalledWith({
      appId: 'app-1',
      appName: 'Research Agent',
    })
  })

  it('returns to the roster after deleting the current agent', async () => {
    const user = userEvent.setup()
    renderAgentDetailSection()

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: /agentV2\.roster\.deleteDialog\.title/,
    })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith('/agents')
    })
    expect(mocks.deleteAgent.mock.calls[0]?.[0]).toEqual({
      params: {
        agent_id: 'agent-1',
      },
    })
  })

  it('keeps the current agent open when deletion fails', async () => {
    const user = userEvent.setup()
    mocks.deleteAgent.mockRejectedValue(new Error('Delete failed'))
    renderAgentDetailSection()

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: /agentV2\.roster\.deleteDialog\.title/,
    })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.deleteAgent).toHaveBeenCalled()
    })
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
  })

  it('does not render more actions in collapsed sidebar mode', () => {
    renderAgentDetailSection(false)

    expect(
      screen.queryByRole('button', { name: /agentV2\.roster\.moreActions/ }),
    ).not.toBeInTheDocument()
  })
})

describe('AgentDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links the combined home control to home', () => {
    render(<AgentDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/agents')
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })
})
