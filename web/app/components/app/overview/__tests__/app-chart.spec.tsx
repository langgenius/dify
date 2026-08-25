import { render, screen } from '@testing-library/react'
import Chart, { MessagesChart } from '../app-chart'

const reactEChartsMock = vi.fn()
vi.mock('echarts-for-react', () => ({
  default: (props: { option: unknown; opts?: unknown }) => {
    reactEChartsMock(props)
    return <div role="img" aria-label="Chart" />
  },
}))

const mockUseAppDailyMessages = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseAppDailyMessages(...args),
}))

describe('app-chart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reactEChartsMock.mockClear()
  })

  describe('Chart', () => {
    it('should render cost summaries with token pricing details', () => {
      render(
        <Chart
          basicInfo={{
            title: 'Cost title',
            explanation: 'Cost explanation',
            timePeriod: 'Last 7 days',
          }}
          chartType="costs"
          chartData={{
            data: [
              { date: 'Jan 1, 2024', count: 100, total_price: 1.25 },
              { date: 'Jan 2, 2024', count: 200, total_price: 2.5 },
            ],
          }}
        />,
      )

      expect(screen.getByText('Cost title'))!.toBeInTheDocument()
      expect(screen.getByText('300'))!.toBeInTheDocument()
      expect(screen.queryByText('Last 7 days'))!.not.toBeInTheDocument()
      expect(screen.getByText(/\$3\.7500/))!.toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Chart' }))!.toBeInTheDocument()
    })
  })

  describe('MessagesChart', () => {
    it('should render fallback chart data when the API returns no rows', () => {
      mockUseAppDailyMessages.mockReturnValue({
        data: { data: [] },
        isLoading: false,
      })

      render(
        <MessagesChart
          id="app-1"
          period={{
            name: 'Last week',
            query: {
              start: 'Jan 1, 2024',
              end: 'Jan 4, 2024',
            },
          }}
        />,
      )

      expect(screen.getByText(/(?:^|\.)analysis\.totalMessages\.title(?=$|:)/))!.toBeInTheDocument()
      expect(screen.getByText('0'))!.toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Chart' }))!.toBeInTheDocument()

      const chartProps = reactEChartsMock.mock.calls[0]![0] as {
        option: {
          dataset: { source: Array<Record<string, unknown>> }
          yAxis: { max: number }
        }
        opts: { renderer: string }
      }
      const options = chartProps.option

      expect(chartProps.opts).toEqual({ renderer: 'svg' })
      expect(options.yAxis.max).toBe(500)
      expect(options.dataset.source).toHaveLength(3)
      expect(options.dataset.source[0]).toEqual({ date: 'Jan 1, 2024', message_count: 0 })
    })
  })
})
