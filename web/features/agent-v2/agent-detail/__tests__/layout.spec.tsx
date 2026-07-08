import { render, screen, waitFor } from '@testing-library/react'
import { AgentDetailLayout } from '../layout'

const mockReplace = vi.hoisted(() => vi.fn())
const mockAgentQuery = vi.hoisted(() => ({
  data: {
    name: 'Agent',
  } as { name: string } | undefined,
  error: null as unknown,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: vi.fn(() => mockAgentQuery),
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
    replace: mockReplace,
    prefetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        get: {
          queryOptions: vi.fn(input => input),
        },
      },
    },
  },
}))

describe('AgentDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentQuery.data = {
      name: 'Agent',
    }
    mockAgentQuery.error = null
  })

  it('should render detail content without owning navigation landmarks', () => {
    render(
      <AgentDetailLayout agentId="agent-1">
        <div>Agent detail content</div>
      </AgentDetailLayout>,
    )

    expect(screen.getByText('Agent detail content')).toBeInTheDocument()
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Detail sidebar' })).not.toBeInTheDocument()
  })

  it('should redirect to roster when agent detail returns 404', async () => {
    mockAgentQuery.data = undefined
    mockAgentQuery.error = new Response(null, { status: 404 })

    render(
      <AgentDetailLayout agentId="missing-agent">
        <div>Agent detail content</div>
      </AgentDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/roster')
    })
    expect(screen.queryByText('Agent detail content')).not.toBeInTheDocument()
  })
})
