import { render, screen } from '@testing-library/react'
import { AgentDetailPage } from '../pages/agent-detail-page'

describe('AgentDetailPage', () => {
  it('renders the monitoring layout with metric cards', () => {
    render(<AgentDetailPage section="monitoring" />)

    expect(screen.getByRole('region', { name: 'agentV2.agentDetail.sections.monitoring' })).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.totalRuns.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.activeUsers.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.tokenUsage.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.monitoring.metrics.avgInteractions.title')).toBeInTheDocument()

    expect(screen.getByRole('combobox', {
      name: 'agentV2.agentDetail.monitoring.timeRangeLabel',
    })).toHaveTextContent('agentV2.agentDetail.monitoring.timeRanges.last7days')
    expect(screen.getAllByLabelText(/agentV2\.agentDetail\.monitoring\.metrics\..*\.explanation/)).toHaveLength(4)
  })
})
