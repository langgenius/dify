import type { App } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import { useStore } from '@/app/components/app/store'
import { usePathname, useRouter } from '@/next/navigation'
import { fetchAppDetailDirect } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import AppDetailLayout from '../layout-main'

const mockReplace = vi.fn()
let mockPathname = '/app/app-1/workflow'
let mockIsLoadingWorkspacePermissionKeys = false

vi.mock('@/next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    isLoadingWorkspacePermissionKeys: mockIsLoadingWorkspacePermissionKeys,
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
  }),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const mockUsePathname = vi.mocked(usePathname)
const mockUseRouter = vi.mocked(useRouter)
const mockFetchAppDetailDirect = vi.mocked(fetchAppDetailDirect)

const createAppDetail = (overrides: Partial<App> = {}) => ({
  id: 'app-1',
  name: 'Demo App',
  mode: AppModeEnum.WORKFLOW,
  permission_keys: [AppACLPermission.ViewLayout, AppACLPermission.Monitor],
  ...overrides,
}) as App

const waitForAppContent = async () => {
  await waitFor(() => {
    expect(screen.getByText('App page content')).toBeInTheDocument()
  })
}

describe('AppDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/app/app-1/workflow'
    mockIsLoadingWorkspacePermissionKeys = false
    mockUsePathname.mockImplementation(() => mockPathname)
    mockUseRouter.mockReturnValue({
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      push: vi.fn(),
      replace: mockReplace,
      prefetch: vi.fn(),
    })
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail())
    useStore.getState().setAppDetail()
  })

  it('should keep app detail data when navigating between pages in the same app', async () => {
    const { rerender, unmount } = render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )
    await waitForAppContent()
    expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)

    mockPathname = '/app/app-1/logs'
    rerender(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()
    expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)
    expect(useStore.getState().appDetail?.id).toBe('app-1')

    unmount()
    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()
    expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should redirect restricted app pages before exposing app detail content', async () => {
    mockPathname = '/app/app-1/logs'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/workflow')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should allow users with monitor access to open logs directly', async () => {
    mockPathname = '/app/app-1/logs'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ permission_keys: [AppACLPermission.Monitor] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalledWith('/app/app-1/overview')
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should allow users with layout access to open workflow pages directly', async () => {
    mockPathname = '/app/app-1/workflow'

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalledWith('/app/app-1/overview')
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should redirect workflow pages when layout access is missing', async () => {
    mockPathname = '/app/app-1/workflow'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ permission_keys: [] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/develop')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should redirect overview pages when monitor access is missing', async () => {
    mockPathname = '/app/app-1/overview'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/workflow')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should wait for workspace permission keys before redirecting restricted pages', async () => {
    mockIsLoadingWorkspacePermissionKeys = true
    mockPathname = '/app/app-1/overview'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }))

    const { rerender } = render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)
    })
    expect(mockReplace).not.toHaveBeenCalled()
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()

    mockIsLoadingWorkspacePermissionKeys = false
    rerender(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/workflow')
    })
  })

  it('should allow users with monitor access to open overview directly', async () => {
    mockPathname = '/app/app-1/overview'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ permission_keys: [AppACLPermission.Monitor] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalled()
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should redirect access config pages when access config access is missing', async () => {
    mockPathname = '/app/app-1/access-config'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/workflow')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should allow users with access config access to open access config directly', async () => {
    mockPathname = '/app/app-1/access-config'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ permission_keys: [AppACLPermission.AccessConfig] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalled()
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should redirect annotation pages when edit access is missing', async () => {
    mockPathname = '/app/app-1/annotations'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({
      mode: AppModeEnum.CHAT,
      permission_keys: [AppACLPermission.Monitor],
    }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/overview')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should allow users with edit access to open annotations directly', async () => {
    mockPathname = '/app/app-1/annotations'
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({
      mode: AppModeEnum.CHAT,
      permission_keys: [AppACLPermission.Edit],
    }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalled()
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })
})
