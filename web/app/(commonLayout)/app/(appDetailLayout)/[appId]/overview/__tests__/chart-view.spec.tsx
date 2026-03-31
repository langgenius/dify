import { fireEvent, render, screen } from '@testing-library/react'

import ChartView from '../chart-view'

const mockState = vi.hoisted(() => ({
  appDetail: null as null | { mode: string },
  isCloudEdition: true,
}))

vi.mock('@/config', () => ({
  get IS_CLOUD_EDITION() {
    return mockState.isCloudEdition
  },
}))

vi.mock('@/app/components/app/log/filter', () => ({
  TIME_PERIOD_MAPPING: {
    default: { value: -1, name: 'allTime' },
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: typeof mockState.appDetail }) => unknown) => selector({
    appDetail: mockState.appDetail,
  }),
}))

vi.mock('../time-range-picker', () => ({
  default: ({ onSelect }: { onSelect: (payload: { name: string, query: { start: string, end: string } }) => void }) => (
    <button
      type="button"
      onClick={() => onSelect({ name: 'cloud-range', query: { start: '2026-03-01 00:00', end: '2026-03-01 23:59' } })}
    >
      cloud-picker
    </button>
  ),
}))

vi.mock('../long-time-range-picker', () => ({
  default: ({ onSelect }: { onSelect: (payload: { name: string, query?: { start: string, end: string } }) => void }) => (
    <button
      type="button"
      onClick={() => onSelect({ name: 'long-range', query: undefined })}
    >
      long-picker
    </button>
  ),
}))

vi.mock('@/app/components/app/overview/chart/metrics', () => {
  const createChart = (label: string) => ({
    default: ({ id, period }: { id: string, period: { name: string } }) => <div>{`${label}:${id}:${period.name}`}</div>,
  }).default

  return {
    ConversationsChart: createChart('conversations'),
    EndUsersChart: createChart('end-users'),
    AvgSessionInteractions: createChart('avg-session'),
    AvgResponseTime: createChart('avg-response'),
    TokenPerSecond: createChart('tps'),
    UserSatisfactionRate: createChart('satisfaction'),
    CostChart: createChart('cost'),
    MessagesChart: createChart('messages'),
    WorkflowMessagesChart: createChart('workflow-messages'),
    WorkflowDailyTerminalsChart: createChart('workflow-terminals'),
    WorkflowCostChart: createChart('workflow-cost'),
    AvgUserInteractions: createChart('avg-user'),
  }
})

describe('OverviewRouteChartView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.appDetail = null
    mockState.isCloudEdition = true
  })

  it('should render nothing when app detail is unavailable', () => {
    const { container } = render(<ChartView appId="app-1" headerRight={<div>header</div>} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('should render cloud chat metrics and update period from the short picker', () => {
    mockState.appDetail = { mode: 'chat' }

    render(<ChartView appId="app-1" headerRight={<div>header-right</div>} />)

    expect(screen.getByText('common.appMenus.overview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'cloud-picker' })).toBeInTheDocument()
    expect(screen.getByText('conversations:app-1:appLog.filter.period.today')).toBeInTheDocument()
    expect(screen.getByText('avg-session:app-1:appLog.filter.period.today')).toBeInTheDocument()
    expect(screen.getByText('messages:app-1:appLog.filter.period.today')).toBeInTheDocument()
    expect(screen.getByText('header-right')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'cloud-picker' }))

    expect(screen.getByText('conversations:app-1:cloud-range')).toBeInTheDocument()
    expect(screen.queryByText(/workflow-messages/)).not.toBeInTheDocument()
  })

  it('should render completion metrics without chat-only charts', () => {
    mockState.appDetail = { mode: 'completion' }

    render(<ChartView appId="app-2" headerRight={<div>header-right</div>} />)

    expect(screen.getByText('avg-response:app-2:appLog.filter.period.today')).toBeInTheDocument()
    expect(screen.queryByText(/avg-session:app-2/)).not.toBeInTheDocument()
    expect(screen.queryByText(/messages:app-2/)).not.toBeInTheDocument()
  })

  it('should render workflow metrics and use the long-range picker outside cloud mode', () => {
    mockState.appDetail = { mode: 'workflow' }
    mockState.isCloudEdition = false

    render(<ChartView appId="app-3" headerRight={<div>header-right</div>} />)

    expect(screen.getByRole('button', { name: 'long-picker' })).toBeInTheDocument()
    expect(screen.getByText('workflow-messages:app-3:appLog.filter.period.last7days')).toBeInTheDocument()
    expect(screen.getByText('workflow-cost:app-3:appLog.filter.period.last7days')).toBeInTheDocument()
    expect(screen.queryByText(/conversations:app-3/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'long-picker' }))

    expect(screen.getByText('workflow-messages:app-3:long-range')).toBeInTheDocument()
  })
})
