import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useAppContext } from '@/context/app-context'
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

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
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

vi.mock('@/app/components/detail-sidebar', () => ({
  DetailSidebarFrame: () => <aside aria-label="Detail sidebar" />,
}))

vi.mock('../navigation', () => ({
  AgentDetailTop: () => null,
  AgentDetailSection: () => null,
}))

describe('AgentDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useAppContext as Mock).mockReturnValue({
      isCurrentWorkspaceDatasetOperator: false,
    })
  })

  it('should own the skip target when the detail sidebar is available', () => {
    render(
      <AgentDetailLayout agentId="agent-1">
        <div>Agent detail content</div>
      </AgentDetailLayout>,
    )

    const main = screen.getByRole('main')

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveTextContent('Agent detail content')
    expect(screen.getByRole('complementary', { name: 'Detail sidebar' })).toBeInTheDocument()
  })

  it('should defer the skip target to the global layout for dataset operators', () => {
    ;(useAppContext as Mock).mockReturnValue({
      isCurrentWorkspaceDatasetOperator: true,
    })

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
