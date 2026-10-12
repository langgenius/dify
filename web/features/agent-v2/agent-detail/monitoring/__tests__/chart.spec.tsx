import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentMonitoringChart } from '../chart'

vi.mock('echarts-for-react/esm/core', () => ({
  default: ({ 'aria-hidden': ariaHidden }: { 'aria-hidden'?: boolean }) => (
    <div aria-hidden={ariaHidden} data-testid="monitoring-chart-canvas" />
  ),
}))

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => 'en-US',
}))

describe('AgentMonitoringChart', () => {
  it('provides every chart date and value as an accessible table', () => {
    render(
      <AgentMonitoringChart
        titleKey="agentDetail.monitoring.metrics.totalMessages.title"
        explanationKey="agentDetail.monitoring.metrics.totalMessages.explanation"
        summaryValue="4"
        chartType="conversations"
        valueKey="message_count"
        rows={[
          { date: '2026-09-28', message_count: 0 },
          { date: '2026-09-29', message_count: 4 },
        ]}
        yMaxWhenEmpty={500}
      />,
    )

    const table = screen.getByRole('table', {
      name: 'agentV2.agentDetail.monitoring.metrics.totalMessages.title',
    })
    const rows = within(table).getAllByRole('row')

    expect(rows).toHaveLength(3)
    expect(within(rows[1]!).getByRole('time')).toHaveAttribute('datetime', '2026-09-28')
    expect(within(rows[1]!).getByRole('time')).toHaveTextContent('Sep 28, 2026')
    expect(within(rows[1]!).getByRole('cell', { name: '0' })).toBeInTheDocument()
    expect(within(rows[2]!).getByRole('cell', { name: '4' })).toBeInTheDocument()
    expect(screen.getByTestId('monitoring-chart-canvas')).toHaveAttribute('aria-hidden', 'true')
  })

  it('includes each day’s estimated cost in the token table', () => {
    render(
      <AgentMonitoringChart
        titleKey="agentDetail.monitoring.metrics.tokenUsage.title"
        explanationKey="agentDetail.monitoring.metrics.tokenUsage.explanation"
        summaryValue="2"
        chartType="tokenUsage"
        valueKey="token_count"
        rows={[{ date: '2026-09-29', token_count: 2, total_price: '0.0005' }]}
        yMaxWhenEmpty={100}
      />,
    )

    const table = screen.getByRole('table', {
      name: 'agentV2.agentDetail.monitoring.metrics.tokenUsage.title',
    })

    expect(within(table).getByRole('cell', { name: '2' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '$0.0005' })).toBeInTheDocument()
  })

  it('lets keyboard users reveal and hide the chart data', async () => {
    const user = userEvent.setup()
    render(
      <AgentMonitoringChart
        titleKey="agentDetail.monitoring.metrics.totalMessages.title"
        explanationKey="agentDetail.monitoring.metrics.totalMessages.explanation"
        summaryValue="4"
        chartType="conversations"
        valueKey="message_count"
        rows={[{ date: '2026-09-29', message_count: 4 }]}
        yMaxWhenEmpty={500}
      />,
    )

    const showButton = screen.getByRole('button', {
      name: 'agentV2.agentDetail.monitoring.table.viewData',
    })
    const table = screen.getByRole('table')
    expect(showButton).toHaveAttribute('aria-expanded', 'false')
    expect(table.parentElement).toHaveClass('sr-only')

    showButton.focus()
    await user.keyboard('{Enter}')
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.monitoring.table.hideData' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(table.parentElement).not.toHaveClass('sr-only')
    expect(within(table).getByRole('cell', { name: '4' })).toBeVisible()

    await user.keyboard(' ')
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.monitoring.table.viewData' }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(table.parentElement).toHaveClass('sr-only')
  })
})
