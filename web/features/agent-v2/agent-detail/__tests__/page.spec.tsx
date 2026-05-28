import type { Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { usePathname, useRouter } from '@/next/navigation'
import { AgentDetailPage } from '../page'

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="agent-monitoring-chart" />,
}))

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    usePathname: vi.fn(),
    useRouter: vi.fn(),
  }
})

describe('AgentDetailPage', () => {
  const push = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(usePathname as Mock).mockReturnValue('/roster/agent-1/access')
    ;(useRouter as Mock).mockReturnValue({ push })
  })

  it('renders the logs skeleton with filters and table rows', () => {
    render(<AgentDetailPage agentId="agent-1" section="logs" />)

    expect(screen.getByRole('region', { name: 'agentV2.agentDetail.sections.logs' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'agentV2.agentDetail.logs.title' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', {
      name: 'agentV2.agentDetail.logs.filters.status.label',
    })).toHaveTextContent('agentV2.agentDetail.logs.filters.status.all')
    expect(screen.getByRole('combobox', {
      name: 'agentV2.agentDetail.logs.filters.period.label',
    })).toHaveTextContent('agentV2.agentDetail.logs.filters.period.last7days')
    expect(screen.getByRole('textbox', {
      name: 'agentV2.agentDetail.logs.filters.search.label',
    })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'agentV2.agentDetail.logs.table.startTime' })).toBeInTheDocument()
    expect(screen.getByText('run_8f4e21')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument()
  })

  it('renders the monitoring layout with metric cards', () => {
    render(<AgentDetailPage agentId="agent-1" section="monitoring" />)

    expect(screen.getByRole('region', { name: 'agentV2.agentDetail.sections.monitoring' })).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.title')).toBeInTheDocument()
    expect(screen.getByRole('combobox', {
      name: 'agentV2.agentDetail.monitoring.timeRangeLabel',
    })).toHaveTextContent('agentV2.agentDetail.monitoring.timeRanges.today')
    expect(screen.getByRole('combobox', {
      name: 'agentV2.agentDetail.monitoring.sourceLabel',
    })).toHaveTextContent('agentV2.agentDetail.access.entries.webapp.name')
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.totalConversations.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.activeUsers.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.avgSessionInteractions.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.tokenOutputSpeed.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.userSatisfactionRate.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.tokenUsage.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.totalMessages.title')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/agentV2\.agentDetail\.monitoring\.metrics\..*\.explanation/)).toHaveLength(7)
    expect(screen.getAllByTestId('agent-monitoring-chart')).toHaveLength(7)
  })

  it('routes access actions to the target tab', async () => {
    render(<AgentDetailPage agentId="agent-1" section="access" />)

    expect(screen.getByRole('region', { name: 'agentV2.agentDetail.sections.access' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'agentV2.agentDetail.access.title' })).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.access.entries.webapp.name')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', {
      name: /agentV2\.agentDetail\.access\.moreActions/,
    })[0]!)
    fireEvent.click(await screen.findByText('agentV2.agentDetail.sections.logs'))

    expect(push).toHaveBeenCalledWith('/roster/agent-1/logs')
  })
})
