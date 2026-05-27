import { render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useAppDetail } from '@/service/use-apps'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import AppDetailLayout from '../layout-main'

const mockReplace = vi.fn()
let mockPathname = '/app/app-1/overview'
let mockWorkspacePermissionKeys: string[] = []

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => mockPathname,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }),
  useSelector: <T,>(selector: (state: { userProfile: { id: string } }) => T) => selector({
    userProfile: { id: 'user-1' },
  }),
}))

const mockSetAppDetail = vi.fn()
const mockSetAppSidebarExpand = vi.fn()

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: {
      id: 'app-1',
      name: 'Test App',
      mode: AppModeEnum.CHAT,
      permission_keys: [],
    },
    setAppDetail: mockSetAppDetail,
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}))

vi.mock('@/service/use-apps', () => ({
  useAppDetail: vi.fn(),
}))

vi.mock('@/app/components/app-sidebar', () => ({
  default: () => <div data-testid="app-sidebar" />,
}))

vi.mock('@/app/components/app-sidebar/app-info', () => ({
  AppInfoDetailLayer: () => <div data-testid="app-info-detail-layer" />,
}))

vi.mock('@/app/components/app-sidebar/app-info/use-app-info-actions', () => ({
  useAppInfoActions: () => ({}),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
  },
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@remixicon/react', () => ({
  RiDashboard2Fill: () => null,
  RiDashboard2Line: () => null,
  RiFileList3Fill: () => null,
  RiFileList3Line: () => null,
  RiTerminalBoxFill: () => null,
  RiTerminalBoxLine: () => null,
  RiTerminalWindowFill: () => null,
  RiTerminalWindowLine: () => null,
  RiUserSettingsFill: () => null,
  RiUserSettingsLine: () => null,
}))

describe('AppDetailLayout permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/app/app-1/overview'
    mockWorkspacePermissionKeys = []
    vi.mocked(useAppDetail).mockReturnValue({
      data: {
        id: 'app-1',
        name: 'Test App',
        mode: AppModeEnum.CHAT,
        permission_keys: [],
      },
      error: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useAppDetail>)
  })

  it('subscribes to app detail query and publishes query data into the app store', async () => {
    mockWorkspacePermissionKeys = ['app.monitor.access']

    render(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)

    await waitFor(() => {
      expect(useAppDetail).toHaveBeenCalledWith('app-1')
      expect(mockSetAppDetail).toHaveBeenCalledWith(expect.objectContaining({
        id: 'app-1',
        enable_sso: false,
      }))
    })
  })

  it('does not re-subscribe the app detail query just because the child route changes', async () => {
    mockWorkspacePermissionKeys = ['app.monitor.access']

    const { rerender } = render(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)
    await waitFor(() => {
      expect(mockSetAppDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'app-1' }))
    })

    vi.mocked(useAppDetail).mockClear()
    mockPathname = '/app/app-1/logs'
    rerender(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)

    await waitFor(() => {
      expect(mockReplace).not.toHaveBeenCalledWith('/apps')
    })
    expect(useAppDetail).toHaveBeenCalledWith('app-1')
  })

  it('redirects to app list when app detail query returns 404', async () => {
    vi.mocked(useAppDetail).mockReturnValue({
      data: undefined,
      error: { status: 404 },
      isLoading: false,
    } as unknown as ReturnType<typeof useAppDetail>)

    render(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('redirects direct overview access to app list when no app surface is available', async () => {
    render(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('allows direct overview access with workspace monitor permission', async () => {
    mockWorkspacePermissionKeys = ['app.monitor.access']

    render(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)

    await waitFor(() => {
      expect(useAppDetail).toHaveBeenCalledWith('app-1')
    })
    expect(mockReplace).not.toHaveBeenCalledWith('/app/app-1/develop')
  })

  it('allows test-and-run users to access the workflow layout directly', async () => {
    mockPathname = '/app/app-1/workflow'
    vi.mocked(useAppDetail).mockReturnValue({
      data: {
        id: 'app-1',
        name: 'Test App',
        mode: AppModeEnum.WORKFLOW,
        permission_keys: [AppACLPermission.TestAndRun],
      },
      error: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useAppDetail>)

    render(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)

    await waitFor(() => {
      expect(useAppDetail).toHaveBeenCalledWith('app-1')
    })
    expect(mockReplace).not.toHaveBeenCalledWith('/app/app-1/overview')
  })
})
