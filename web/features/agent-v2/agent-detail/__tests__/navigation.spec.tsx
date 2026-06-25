import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { render, screen } from '@testing-library/react'
import { AgentDetailSection } from '../navigation'

const mocks = vi.hoisted(() => ({
  pathname: '/roster/agent/agent-1/configure',
  queryData: undefined as AgentAppDetailWithSite | undefined,
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
  }),
}))

vi.mock('@/app/components/app-sidebar/nav-link', () => ({
  default: ({ href, name }: { href: string, name: string }) => <a href={href}>{name}</a>,
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

const createAgent = (overrides: Partial<AgentAppDetailWithSite> = {}): AgentAppDetailWithSite => ({
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

describe('AgentDetailSection', () => {
  beforeEach(() => {
    mocks.pathname = '/roster/agent/agent-1/configure'
    mocks.queryData = createAgent()
  })

  it('renders the current agent avatar, name, and role', () => {
    const { container } = render(<AgentDetailSection />)
    const agentName = screen.getByText('Research Agent')
    const agentAvatar = container.querySelector('em-emoji')?.parentElement

    expect(agentName).toBeInTheDocument()
    expect(screen.getByText('Research Assistant')).toBeInTheDocument()
    expect(screen.queryByText('agent')).not.toBeInTheDocument()
    expect(screen.queryByText('agentV2.agentDetail.title')).not.toBeInTheDocument()
    expect(container.querySelector('em-emoji')).toHaveAttribute('id', '🧪')
    expect(agentAvatar).toHaveClass('h-10', 'w-10', 'rounded-full')
    expect(agentAvatar?.parentElement?.parentElement).toHaveClass('mr-2')
    expect(agentName.parentElement).toHaveClass('h-10')
    expect(agentName.parentElement?.parentElement).toHaveClass('h-13', 'py-1.5', 'pl-1.5', 'pr-2')
  })
})
