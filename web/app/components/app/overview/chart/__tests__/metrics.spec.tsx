import type { EChartsOption } from 'echarts'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import Chart from '../core'
import {
  AvgResponseTime,
  AvgSessionInteractions,
  AvgUserInteractions,
  ConversationsChart,
  CostChart,
  EndUsersChart,
  MessagesChart,
  TokenPerSecond,
  UserSatisfactionRate,
  WorkflowCostChart,
  WorkflowDailyTerminalsChart,
  WorkflowMessagesChart,
} from '../metrics'

const mockUseAppDailyMessages = vi.fn()
const mockUseAppDailyConversations = vi.fn()
const mockUseAppDailyEndUsers = vi.fn()
const mockUseAppAverageSessionInteractions = vi.fn()
const mockUseAppAverageResponseTime = vi.fn()
const mockUseAppTokensPerSecond = vi.fn()
const mockUseAppSatisfactionRate = vi.fn()
const mockUseAppTokenCosts = vi.fn()
const mockUseWorkflowDailyConversations = vi.fn()
const mockUseWorkflowDailyTerminals = vi.fn()
const mockUseWorkflowTokenCosts = vi.fn()
const mockUseWorkflowAverageInteractions = vi.fn()

let latestOption: EChartsOption | undefined

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: EChartsOption }) => {
    latestOption = option
    return <div data-testid="echart" />
  },
}))

vi.mock('@/app/components/app-sidebar/basic', () => ({
  default: ({ name, type, hoverTip, isExtraInLine }: {
    name: ReactNode
    type: ReactNode
    hoverTip?: string
    isExtraInLine?: boolean
  }) => (
    <div data-testid="basic">
      <div>{name}</div>
      <div>{type}</div>
      {hoverTip && <div>{hoverTip}</div>}
      {isExtraInLine && <div>inline-extra</div>}
    </div>
  ),
}))

vi.mock('@/service/use-apps', () => ({
  useAppDailyMessages: (...args: unknown[]) => mockUseAppDailyMessages(...args),
  useAppDailyConversations: (...args: unknown[]) => mockUseAppDailyConversations(...args),
  useAppDailyEndUsers: (...args: unknown[]) => mockUseAppDailyEndUsers(...args),
  useAppAverageSessionInteractions: (...args: unknown[]) => mockUseAppAverageSessionInteractions(...args),
  useAppAverageResponseTime: (...args: unknown[]) => mockUseAppAverageResponseTime(...args),
  useAppTokensPerSecond: (...args: unknown[]) => mockUseAppTokensPerSecond(...args),
  useAppSatisfactionRate: (...args: unknown[]) => mockUseAppSatisfactionRate(...args),
  useAppTokenCosts: (...args: unknown[]) => mockUseAppTokenCosts(...args),
  useWorkflowDailyConversations: (...args: unknown[]) => mockUseWorkflowDailyConversations(...args),
  useWorkflowDailyTerminals: (...args: unknown[]) => mockUseWorkflowDailyTerminals(...args),
  useWorkflowTokenCosts: (...args: unknown[]) => mockUseWorkflowTokenCosts(...args),
  useWorkflowAverageInteractions: (...args: unknown[]) => mockUseWorkflowAverageInteractions(...args),
}))

const defaultPeriod = {
  name: 'Last 7 days',
  query: {
    start: '2026-03-01',
    end: '2026-03-08',
  },
}

const buildResult = (data: Array<Record<string, string | number>>) => ({
  data: { data },
  isLoading: false,
})

const setDefaultHookResponses = () => {
  mockUseAppDailyMessages.mockReturnValue(buildResult([{ date: '2026-03-01', message_count: 5 }]))
  mockUseAppDailyConversations.mockReturnValue(buildResult([{ date: '2026-03-01', conversation_count: 3 }]))
  mockUseAppDailyEndUsers.mockReturnValue(buildResult([{ date: '2026-03-01', terminal_count: 2 }]))
  mockUseAppAverageSessionInteractions.mockReturnValue(buildResult([{ date: '2026-03-01', interactions: 4 }]))
  mockUseAppAverageResponseTime.mockReturnValue(buildResult([{ date: '2026-03-01', latency: 120 }]))
  mockUseAppTokensPerSecond.mockReturnValue(buildResult([{ date: '2026-03-01', tps: 8 }]))
  mockUseAppSatisfactionRate.mockReturnValue(buildResult([{ date: '2026-03-01', rate: 95 }]))
  mockUseAppTokenCosts.mockReturnValue(buildResult([{ date: '2026-03-01', token_count: 1200, total_price: 1.2345, currency: 1 }]))
  mockUseWorkflowDailyConversations.mockReturnValue(buildResult([{ date: '2026-03-01', runs: 7 }]))
  mockUseWorkflowDailyTerminals.mockReturnValue(buildResult([{ date: '2026-03-01', terminal_count: 6 }]))
  mockUseWorkflowTokenCosts.mockReturnValue(buildResult([{ date: '2026-03-01', token_count: 900, total_price: 0.5678, currency: 1 }]))
  mockUseWorkflowAverageInteractions.mockReturnValue(buildResult([{ date: '2026-03-01', interactions: 9 }]))
}

describe('app-chart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestOption = undefined
    setDefaultHookResponses()
  })

  it('renders direct chart totals and cost labels', () => {
    render(
      <Chart
        basicInfo={{
          title: 'Token usage',
          explanation: 'Cost explanation',
          timePeriod: 'Last 7 days',
        }}
        chartType="costs"
        chartData={{
          data: [{ date: '2026-03-01', token_count: 1200, total_price: 1.2345, currency: 1 }],
        }}
      />,
    )

    expect(screen.getAllByTestId('basic')[0]).toHaveTextContent('Token usage')
    expect(screen.getAllByTestId('basic')[1]).toHaveTextContent('1k')
    expect(screen.getAllByTestId('basic')[1]).toHaveTextContent('appOverview.analysis.tokenUsage.consumed')
    expect(latestOption).toMatchObject({
      dataset: {
        dimensions: ['date', 'token_count'],
      },
    })
  })

  it('shows loading state while a wrapper hook is pending', () => {
    mockUseAppDailyMessages.mockReturnValue({ data: undefined, isLoading: true })

    render(<MessagesChart id="app-1" period={defaultPeriod} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('falls back to empty chart data when the response has no rows', () => {
    mockUseAppAverageResponseTime.mockReturnValue({ data: { data: [] }, isLoading: false })

    render(<AvgResponseTime id="app-1" period={defaultPeriod} />)

    expect(screen.getAllByTestId('basic')[1]).toHaveTextContent('0 appOverview.analysis.ms')
    expect(latestOption).toMatchObject({
      yAxis: {
        max: 500,
      },
    })
  })

  it.each([
    ['messages', MessagesChart],
    ['conversations', ConversationsChart],
    ['end-users', EndUsersChart],
    ['avg-session-interactions', AvgSessionInteractions],
    ['avg-response-time', AvgResponseTime],
    ['tokens-per-second', TokenPerSecond],
    ['user-satisfaction', UserSatisfactionRate],
    ['costs', CostChart],
    ['workflow-messages', WorkflowMessagesChart],
    ['workflow-terminals', WorkflowDailyTerminalsChart],
    ['workflow-costs', WorkflowCostChart],
    ['avg-user-interactions', AvgUserInteractions],
  ])('renders the %s chart wrapper', (_label, Component) => {
    render(<Component id="app-1" period={defaultPeriod} />)

    expect(screen.getByTestId('echart')).toBeInTheDocument()
  })
})
