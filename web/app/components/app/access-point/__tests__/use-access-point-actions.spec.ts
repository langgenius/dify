import { act } from '@testing-library/react'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useAccessPointActions } from '../shared/use-access-point-actions'

const mocks = vi.hoisted(() => ({
  onAppStateUpdate: vi.fn(() => vi.fn()),
  setAppDetail: vi.fn(),
  updateAppSiteStatus: vi.fn().mockResolvedValue({}),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: vi.fn() }))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppDetail: typeof mocks.setAppDetail }) => unknown) =>
    selector({ setAppDetail: mocks.setAppDetail }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: { onAppStateUpdate: mocks.onAppStateUpdate },
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: { getSocket: vi.fn() },
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetail: vi.fn().mockResolvedValue({}),
  updateAppSiteAccessToken: vi.fn(),
  updateAppSiteConfig: vi.fn(),
  updateAppSiteStatus: mocks.updateAppSiteStatus,
}))

describe('useAccessPointActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows the API status to be changed independently of app editing', async () => {
    const { result } = renderHookWithConsoleQuery(() => useAccessPointActions('app-1', false))

    await act(() => result.current.changeApiStatus(true))

    expect(mocks.updateAppSiteStatus).toHaveBeenCalledWith({
      url: '/apps/app-1/api-enable',
      body: { enable_api: true },
    })
  })
})
