import { render, screen } from '@testing-library/react'
import { AgentDetailLayout } from '../layout'

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: vi.fn(() => ({
      data: {
        name: 'Agent',
      },
    })),
  }
})

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
})
