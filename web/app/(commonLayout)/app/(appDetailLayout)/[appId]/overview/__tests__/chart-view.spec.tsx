import { render, screen } from '@testing-library/react'
import { AppACLPermission } from '@/utils/permission'
import ChartView from '../chart-view'

const testState = vi.hoisted(() => ({
  appDetail: {
    id: 'app-1',
    mode: 'chat',
    maintainer: 'maintainer-1',
    permission_keys: [] as string[],
  },
  currentUserId: 'user-1',
  workspacePermissionKeys: [] as string[],
  chartRenderSpy: vi.fn(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: { appDetail: typeof testState.appDetail }) => T): T => selector({
    appDetail: testState.appDetail,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: vi.fn((selector: (state: { userProfile: { id: string }, workspacePermissionKeys: string[] }) => unknown) => selector({
    userProfile: { id: testState.currentUserId },
    workspacePermissionKeys: testState.workspacePermissionKeys,
  })),
}))

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
  ConversationsChart: () => {
    testState.chartRenderSpy('conversations')
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

describe('ChartView monitor permission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.appDetail = {
      id: 'app-1',
      mode: 'chat',
      maintainer: 'maintainer-1',
      permission_keys: [],
    }
    testState.currentUserId = 'user-1'
    testState.workspacePermissionKeys = []
  })

  // Monitoring charts are part of the app monitor permission surface.
  describe('Permissions', () => {
    it('should not render monitoring charts when app monitor permission is missing', () => {
      render(<ChartView appId="app-1" headerRight={<button type="button">header action</button>} />)

      expect(screen.queryByRole('heading', { name: 'common.appMenus.overview' })).not.toBeInTheDocument()
      expect(screen.queryByText('header action')).not.toBeInTheDocument()
      expect(testState.chartRenderSpy).not.toHaveBeenCalled()
    })

    it('should render monitoring charts when app monitor permission is granted', () => {
      testState.appDetail.permission_keys = [AppACLPermission.Monitor]

      render(<ChartView appId="app-1" headerRight={<button type="button">header action</button>} />)

      expect(screen.getByRole('heading', { name: 'common.appMenus.overview' })).toBeInTheDocument()
      expect(screen.getByText('header action')).toBeInTheDocument()
      expect(screen.getByText('conversations chart')).toBeInTheDocument()
      expect(testState.chartRenderSpy).toHaveBeenCalledWith('conversations')
    })
  })
})
