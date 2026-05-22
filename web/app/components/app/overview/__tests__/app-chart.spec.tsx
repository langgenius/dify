import { render, screen } from '@testing-library/react'
import Chart, { MessagesChart } from '../app-chart'

const reactEChartsMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: unknown }) => {
    reactEChartsMock(option)
    return <div data-testid="echarts" />
  },
}))

const mockUseAppDailyMessages = vi.fn()

vi.mock('@/service/use-apps', () => ({
  useAppAverageResponseTime: vi.fn(),
  useAppAverageSessionInteractions: vi.fn(),
  useAppDailyConversations: vi.fn(),
  useAppDailyEndUsers: vi.fn(),
  useAppDailyMessages: (...args: unknown[]) => mockUseAppDailyMessages(...args),
  useAppSatisfactionRate: vi.fn(),
  useAppTokenCosts: vi.fn(),
  useAppTokensPerSecond: vi.fn(),
  useWorkflowAverageInteractions: vi.fn(),
  useWorkflowDailyConversations: vi.fn(),
  useWorkflowDailyTerminals: vi.fn(),
  useWorkflowTokenCosts: vi.fn(),
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
      expect(screen.getByText(/\$3\.7500/))!.toBeInTheDocument()
      expect(screen.getByTestId('echarts'))!.toBeInTheDocument()
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

      expect(screen.getByText('analysis.totalMessages.title'))!.toBeInTheDocument()
      expect(screen.getByTestId('echarts'))!.toBeInTheDocument()

      const options = reactEChartsMock.mock.calls[0]![0] as {
        dataset: { source: Array<Record<string, unknown>> }
        yAxis: { max: number }
      }

      expect(options.yAxis.max).toBe(500)
      expect(options.dataset.source).toHaveLength(3)
      expect(options.dataset.source[0]).toEqual({ date: 'Jan 1, 2024', count: 0 })
    })
  })
})
