import type { ReactNode } from 'react'
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense } from 'react'
import CommonLayoutError from '@/app/(commonLayout)/error'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import OverviewView from '../view'

const testState = vi.hoisted(() => ({
  request: vi.fn<() => Promise<Response>>(),
  appDetail: {
    id: 'app-1',
    mode: 'chat',
    maintainer: 'maintainer-1',
    permission_keys: [] as string[],
  },
  currentUserId: 'user-1',
  workspacePermissionKeys: [] as string[],
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: testState.request,
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

it('shows the page fallback until required app details resolve', async () => {
  let resolveRequest: (response: Response) => void = () => {}
  testState.request.mockReturnValue(
    new Promise<Response>((resolve) => {
      resolveRequest = resolve
    }),
  )
  renderWithConsoleQuery(
    <Suspense fallback={<div>Loading overview</div>}>
      <OverviewView appId="loading-app" />
    </Suspense>,
  )
  expect(screen.getByText('Loading overview')).toBeInTheDocument()
  expect(screen.queryByText('api key info panel')).not.toBeInTheDocument()
  await act(async () => {
    resolveRequest(
      Response.json(
        createAppDetailFixture({
          id: 'loading-app',
          permission_keys: [AppACLPermission.Monitor],
        }),
      ),
    )
  })
  expect(await screen.findByText(/chart view loading-app/)).toBeInTheDocument()
  expect(screen.queryByText('Loading overview')).not.toBeInTheDocument()
})

it('recovers an initial detail failure through the existing route error action', async () => {
  const user = userEvent.setup()
  testState.request.mockRejectedValue(new Error('Detail unavailable'))
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    renderWithConsoleQuery(
      <QueryErrorResetBoundary>
        <ErrorBoundary
          fallback={(error, retry) => <CommonLayoutError error={error} retry={retry} />}
        >
          <Suspense fallback={<div>Loading overview</div>}>
            <OverviewView appId="unavailable-app" />
          </Suspense>
        </ErrorBoundary>
      </QueryErrorResetBoundary>,
    )
    const retry = await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' })
    expect(screen.queryByText('api key info panel')).not.toBeInTheDocument()
    testState.request.mockResolvedValue(
      Response.json(
        createAppDetailFixture({
          id: 'unavailable-app',
          permission_keys: [AppACLPermission.Monitor],
        }),
      ),
    )
    await user.click(retry)
    expect(await screen.findByText(/chart view unavailable-app/)).toBeInTheDocument()
  } finally {
    consoleError.mockRestore()
  }
})

it('keeps loaded content visible when a background refresh fails', async () => {
  testState.appDetail.permission_keys = [AppACLPermission.Monitor]
  testState.request.mockRejectedValue(new Error('Refresh unavailable'))
  const { queryClient } = render(<OverviewView appId="app-1" />)
  await act(async () => {
    await queryClient.invalidateQueries({
      queryKey: consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    })
  })
  expect(screen.getByText(/chart view app-1/)).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'common.errorBoundary.tryAgain' }),
  ).not.toBeInTheDocument()
})
