import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import type { SystemFeatures } from '@/features/system-features/config'
import { act, screen } from '@testing-library/react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
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
  conversationPeriodSpy: vi.fn(),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: { appDetail: typeof testState.appDetail }) => T): T =>
    selector({
      appDetail: testState.appDetail,
    }),
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

      expect(
        screen.queryByRole('heading', { name: 'common.appMenus.overview' }),
      ).not.toBeInTheDocument()
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

    it('should use the Cloud default period when an unknown edition resolves to Cloud', async () => {
      testState.appDetail.permission_keys = [AppACLPermission.Monitor]

      const { queryClient } = render(
        <ChartView appId="app-1" headerRight={<button type="button">header action</button>} />,
        { systemFeatures: { deployment_edition: null } },
      )
      const queryKey = systemFeaturesQueryOptions().queryKey
      const systemFeatures = queryClient.getQueryData<SystemFeatures>(queryKey)

      expect(screen.queryByRole('button', { name: 'time range' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'long time range' })).not.toBeInTheDocument()

      act(() => {
        queryClient.setQueryData(queryKey, {
          ...systemFeatures!,
          deployment_edition: 'CLOUD',
        })
      })

      expect(await screen.findByRole('button', { name: 'time range' })).toBeInTheDocument()
      expect(testState.conversationPeriodSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: 'appLog.filter.period.today' }),
      )
    })
  })
})
