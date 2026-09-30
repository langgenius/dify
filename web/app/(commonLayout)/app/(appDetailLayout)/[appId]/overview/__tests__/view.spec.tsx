import type { ReactNode } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import OverviewView from '../view'

const testState = vi.hoisted(() => ({
  appDetail: {
    id: 'app-1',
    mode: 'chat',
    maintainer: 'maintainer-1',
    permission_keys: [] as string[],
  },
  currentUserId: 'user-1',
  workspacePermissionKeys: [] as string[],
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/app/components/app/overview/apikey-info-panel', () => ({
  default: () => <div>api key info panel</div>,
}))

vi.mock('../chart-view', () => ({
  default: ({ appId, headerRight }: { appId: string; headerRight: ReactNode }) => (
    <div>
      chart view {appId}
      {headerRight}
    </div>
  ),
}))

vi.mock('../tracing/panel', () => ({
  default: () => <button type="button">tracing</button>,
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => {
  const queryClient = createConsoleQueryClient()
  const detail = createAppDetailFixture({ ...testState.appDetail, mode: 'chat' })
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: detail.id } } }),
    detail,
  )
  return renderWithConsoleQuery(ui, { queryClient })
}

describe('OverviewView monitor permission', () => {
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

  // The overview page should be controlled as one monitor-permission surface.
  describe('Permissions', () => {
    it('should not render overview page content when app monitor permission is missing', () => {
      render(<OverviewView appId="app-1" />)

      expect(screen.queryByText('api key info panel')).not.toBeInTheDocument()
      expect(screen.queryByText(/chart view app-1/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'tracing' })).not.toBeInTheDocument()
    })

    it('should render overview page content without tracing entry when only app monitor permission is granted', () => {
      testState.appDetail.permission_keys = [AppACLPermission.Monitor]

      render(<OverviewView appId="app-1" />)

      expect(screen.getByText('api key info panel')).toBeInTheDocument()
      expect(screen.getByText(/chart view app-1/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'tracing' })).not.toBeInTheDocument()
    })

    it('should render tracing entry when app tracing config permission is granted with monitor access', () => {
      testState.appDetail.permission_keys = [
        AppACLPermission.Monitor,
        AppACLPermission.TracingConfig,
      ]

      render(<OverviewView appId="app-1" />)

      expect(screen.getByText('api key info panel')).toBeInTheDocument()
      expect(screen.getByText(/chart view app-1/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'tracing' })).toBeInTheDocument()
    })

    it('should not render overview page content when only app tracing config permission is granted', () => {
      testState.appDetail.permission_keys = [AppACLPermission.TracingConfig]

      render(<OverviewView appId="app-1" />)

      expect(screen.queryByText('api key info panel')).not.toBeInTheDocument()
      expect(screen.queryByText(/chart view app-1/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'tracing' })).not.toBeInTheDocument()
    })
  })
})

describe('Overview app identity', () => {
  it('uses the destination permissions when navigating between cached apps', async () => {
    testState.appDetail.permission_keys = [AppACLPermission.Monitor, AppACLPermission.TracingConfig]
    const { queryClient, rerender } = render(<OverviewView appId="app-1" />)
    queryClient.setQueryData(
      consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-2' } } }),
      createAppDetailFixture({ id: 'app-2', permission_keys: [] }),
    )
    expect(screen.getByRole('button', { name: 'tracing' })).toBeInTheDocument()

    rerender(<OverviewView appId="app-2" />)
    expect(screen.queryByText('api key info panel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tracing' })).not.toBeInTheDocument()

    act(() => {
      queryClient.setQueryData(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-2' } } }),
        createAppDetailFixture({ id: 'app-2', permission_keys: [AppACLPermission.Monitor] }),
      )
    })
    await screen.findByText(/chart view app-2/)
    act(() => {
      queryClient.setQueryData(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-2' } } }),
        createAppDetailFixture({ id: 'app-2', permission_keys: [] }),
      )
    })
    await waitFor(() => expect(screen.queryByText('api key info panel')).not.toBeInTheDocument())
  })
})

it('surfaces an initial detail failure instead of leaving the overview blank', async () => {
  const queryClient = createConsoleQueryClient()
  const queryKey = consoleQuery.apps.byAppId.get.queryKey({
    input: { params: { app_id: 'unavailable-app' } },
  })
  queryClient.setQueryDefaults(queryKey, { retryOnMount: false })
  await queryClient
    .query({ queryKey, queryFn: () => Promise.reject(new Error('Detail unavailable')) })
    .catch(() => {})
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    renderWithConsoleQuery(
      <ErrorBoundary>
        <OverviewView appId="unavailable-app" />
      </ErrorBoundary>,
      { queryClient },
    )
    expect(
      await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('api key info panel')).not.toBeInTheDocument()
  } finally {
    consoleError.mockRestore()
  }
})
