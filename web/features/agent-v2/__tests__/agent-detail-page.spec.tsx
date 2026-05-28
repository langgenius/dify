import { fireEvent, render, screen } from '@testing-library/react'
import { AgentDetailPage } from '../pages/agent-detail-page'

describe('AgentDetailPage', () => {
  it('renders configurable memory settings', () => {
    render(<AgentDetailPage section="configure" />)

    expect(screen.getByRole('region', { name: 'agentV2.agentDetail.sections.configure' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'agentV2.agentDetail.memorySettings.title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agentV2\.agentDetail\.memorySettings\.strategies\.medium\.label/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /agentV2\.agentDetail\.memorySettings\.isolation\.perApp\.label/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /agentV2\.agentDetail\.memorySettings\.export\.download/ })).toBeInTheDocument()
  })

  it('switches memory strategy and isolation choices', () => {
    render(<AgentDetailPage section="configure" />)

    const economyStrategy = screen.getByRole('button', {
      name: /agentV2\.agentDetail\.memorySettings\.strategies\.economy\.label/,
    })
    const perRunIsolation = screen.getByRole('button', {
      name: /agentV2\.agentDetail\.memorySettings\.isolation\.perRun\.label/,
    })

    fireEvent.click(economyStrategy)
    fireEvent.click(perRunIsolation)

    expect(economyStrategy).toHaveAttribute('aria-pressed', 'true')
    expect(perRunIsolation).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.memorySettings\.strategies\.medium\.label/,
    })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.memorySettings\.isolation\.perApp\.label/,
    })).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders the logs skeleton with filters and table rows', () => {
    render(<AgentDetailPage section="logs" />)

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
