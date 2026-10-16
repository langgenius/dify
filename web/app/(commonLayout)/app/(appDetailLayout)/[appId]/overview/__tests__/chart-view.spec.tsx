import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import ChartView from '../chart-view'

const testState = vi.hoisted(() => ({
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
  AppCharts: ({ period, appMode }: { period: PeriodParams; appMode: string }) => {
    testState.conversationPeriodSpy(period)
    return <div>{appMode} charts</div>
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
    expect(screen.getByText('chat charts')).toBeInTheDocument()
  })

  it('renders completion charts from the explicit app mode', () => {
    renderWithConsoleQuery(<ChartView appId="app-1" appMode="completion" headerRight={null} />)
    expect(screen.getByText('completion charts')).toBeInTheDocument()
  })

  it('renders workflow charts from the explicit app mode', () => {
    renderWithConsoleQuery(<ChartView appId="app-2" appMode="workflow" headerRight={null} />)
    expect(screen.getByText('workflow charts')).toBeInTheDocument()
  })
})
