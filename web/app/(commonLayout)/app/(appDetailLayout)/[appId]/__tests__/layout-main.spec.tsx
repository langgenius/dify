import { render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { fetchAppDetailDirect } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
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

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: vi.fn(),
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
    vi.mocked(fetchAppDetailDirect).mockResolvedValue({
      id: 'app-1',
      name: 'Test App',
      mode: AppModeEnum.CHAT,
      permission_keys: [],
    } as unknown as Awaited<ReturnType<typeof fetchAppDetailDirect>>)
  })

  it('redirects direct overview access when monitor permission is missing', async () => {
    render(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/develop')
    })
  })

  it('allows direct overview access with workspace monitor permission', async () => {
    mockWorkspacePermissionKeys = ['app.monitor.access']

    render(<AppDetailLayout appId="app-1"><div>Child</div></AppDetailLayout>)

    await waitFor(() => {
      expect(fetchAppDetailDirect).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
    })
    expect(mockReplace).not.toHaveBeenCalledWith('/app/app-1/develop')
  })
})
