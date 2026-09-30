import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import ChartView from '../chart-view'

const testState = vi.hoisted(() => ({
  chartRenderSpy: vi.fn(),
  conversationPeriodSpy: vi.fn(),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/app/components/app/overview/app-chart', () => ({
  AvgResponseTime: () => {
    testState.chartRenderSpy('avg-response-time')
    return <div>avg response time chart</div>
  },
  AvgSessionInteractions: () => {
    testState.chartRenderSpy('avg-session-interactions')
    return <div>avg session interactions chart</div>
  },
  AvgUserInteractions: () => {
    testState.chartRenderSpy('avg-user-interactions')
    return <div>avg user interactions chart</div>
  },
  ConversationsChart: ({ period }: { period: PeriodParams }) => {
    testState.chartRenderSpy('conversations')
    testState.conversationPeriodSpy(period)
    return <div>conversations chart</div>
  },
  CostChart: () => {
    testState.chartRenderSpy('cost')
    return <div>cost chart</div>
  },
  EndUsersChart: () => {
    testState.chartRenderSpy('end-users')
    return <div>end users chart</div>
  },
  MessagesChart: () => {
    testState.chartRenderSpy('messages')
    return <div>messages chart</div>
  },
  TokenPerSecond: () => {
    testState.chartRenderSpy('token-per-second')
    return <div>token per second chart</div>
  },
  UserSatisfactionRate: () => {
    testState.chartRenderSpy('user-satisfaction-rate')
    return <div>user satisfaction rate chart</div>
  },
  WorkflowCostChart: () => {
    testState.chartRenderSpy('workflow-cost')
    return <div>workflow cost chart</div>
  },
  WorkflowDailyTerminalsChart: () => {
    testState.chartRenderSpy('workflow-daily-terminals')
    return <div>workflow daily terminals chart</div>
  },
  WorkflowMessagesChart: () => {
    testState.chartRenderSpy('workflow-messages')
    return <div>workflow messages chart</div>
  },
}))

vi.mock('../long-time-range-picker', () => ({
  default: () => <button type="button">long time range</button>,
}))

vi.mock('../time-range-picker', () => ({
  default: () => <button type="button">time range</button>,
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('ChartView', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders chat charts and the page-provided header action', () => {
    renderWithConsoleQuery(
      <ChartView
        appId="app-1"
        appMode="chat"
        headerRight={<button type="button">header action</button>}
      />,
    )

    expect(screen.getByRole('heading', { name: 'common.appMenus.overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'header action' })).toBeInTheDocument()
    expect(screen.getByText('conversations chart')).toBeInTheDocument()
    expect(screen.getByText('avg session interactions chart')).toBeInTheDocument()
  })

  it('renders completion charts from the explicit app mode', () => {
    renderWithConsoleQuery(<ChartView appId="app-1" appMode="completion" headerRight={null} />)
    expect(screen.getByText('avg response time chart')).toBeInTheDocument()
    expect(screen.queryByText('avg session interactions chart')).not.toBeInTheDocument()
  })

  it('renders workflow charts from the explicit app mode', () => {
    renderWithConsoleQuery(<ChartView appId="app-2" appMode="workflow" headerRight={null} />)
    expect(screen.getByText('workflow messages chart')).toBeInTheDocument()
    expect(screen.queryByText('conversations chart')).not.toBeInTheDocument()
  })
})
