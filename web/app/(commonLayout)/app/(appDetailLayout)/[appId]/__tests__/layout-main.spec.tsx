import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import { useStore } from '@/app/components/app/store'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import AppDetailLayout from '../layout-main'

const mockReplace = vi.fn()
const mockAppResponse = vi.fn()
let mockPathname = '/app/app-1/workflow'
let mockIsRbacEnabled = true
const mockConsoleState = vi.hoisted(() => ({
  currentWorkspace: { id: 'workspace-1' },
  isLoadingCurrentWorkspace: false,
  isLoadingWorkspacePermissionKeys: false,
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))
const mockNavigation = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}))

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
  })

vi.mock('@/next/navigation', () => mockNavigation)

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: async (url: string) => {
    const response = await mockAppResponse(url)
    return response instanceof Response ? response : Response.json(response)
  },
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

const mockUsePathname = mockNavigation.usePathname
const mockUseRouter = mockNavigation.useRouter

const createAppDetail = (overrides: Partial<AppDetailWithSite> = {}) =>
  createAppDetailFixture({
    id: 'app-1',
    name: 'Demo App',
    mode: AppModeEnum.WORKFLOW,
    permission_keys: [AppACLPermission.ViewLayout, AppACLPermission.Monitor],
    ...overrides,
  })

const waitForAppContent = async () => {
  await waitFor(() => {
    expect(screen.getByText('App page content')).toBeInTheDocument()
  })
}

describe('AppDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.title = ''
    mockPathname = '/app/app-1/workflow'
    mockIsRbacEnabled = true
    mockConsoleState.currentWorkspace = { id: 'workspace-1' }
    mockConsoleState.isLoadingCurrentWorkspace = false
    mockConsoleState.isLoadingWorkspacePermissionKeys = false
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = []
    mockUsePathname.mockImplementation(() => mockPathname)
    mockUseRouter.mockReturnValue({
      replace: mockReplace,
    })
    mockAppResponse.mockResolvedValue(createAppDetail())
    useStore.getState().setAppDetail()
  })

  describe('Document title', () => {
    it.each([
      ['/app/app-1/workflow', 'common.appMenus.promptEng', AppModeEnum.WORKFLOW],
      ['/app/app-1/configuration', 'common.appMenus.promptEng', AppModeEnum.CHAT],
      ['/app/app-1/access-point', 'common.appMenus.accessPoint', AppModeEnum.WORKFLOW],
      ['/app/app-1/deploy', 'common.appMenus.deploy', AppModeEnum.WORKFLOW],
      ['/app/app-1/logs', 'common.appMenus.logs', AppModeEnum.WORKFLOW],
      ['/app/app-1/annotations', 'common.appMenus.annotations', AppModeEnum.CHAT],
      ['/app/app-1/overview', 'common.appMenus.overview', AppModeEnum.WORKFLOW],
      ['/app/app-1/access-config', 'navigation.settings.resourceAccess', AppModeEnum.WORKFLOW],
    ])('identifies the current detail page for %s', async (pathname, pageTitle, mode) => {
      mockPathname = pathname
      mockAppResponse.mockResolvedValue(
        createAppDetail({
          mode,
          permission_keys: Object.values(AppACLPermission),
        }),
      )

      render(
        <AppDetailLayout appId="app-1">
          <div>App page content</div>
        </AppDetailLayout>,
      )

      await waitFor(() => {
        expect(document.title).toBe(`${pageTitle} · Demo App - Dify`)
      })
    })

    it('updates after a directly loaded app is renamed in the store', async () => {
      render(
        <AppDetailLayout appId="app-1">
          <div>App page content</div>
        </AppDetailLayout>,
      )

      await waitFor(() => {
        expect(document.title).toBe('common.appMenus.promptEng · Demo App - Dify')
      })

      act(() => {
        useStore.getState().setAppDetail(createAppDetail({ name: 'Renamed App' }))
      })

      await waitFor(() => {
        expect(document.title).toBe('common.appMenus.promptEng · Renamed App - Dify')
      })
      expect(mockAppResponse).toHaveBeenCalledTimes(1)
    })
  })

  it('redirects a deleted app after the generated transport returns not found', async () => {
    mockAppResponse.mockResolvedValue(Response.json({ message: 'App not found' }, { status: 404 }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/apps'))
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should keep app detail data when navigating between pages in the same app', async () => {
    const { rerender, unmount } = render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )
    await waitForAppContent()
    expect(mockAppResponse).toHaveBeenCalledWith(expect.stringMatching(/\/apps\/app-1$/))
    expect(mockAppResponse).toHaveBeenCalledTimes(1)

    mockPathname = '/app/app-1/logs'
    rerender(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()
    expect(mockAppResponse).toHaveBeenCalledTimes(1)
    expect(useStore.getState().appDetail?.id).toBe('app-1')

    unmount()
    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()
    expect(mockAppResponse).toHaveBeenCalledTimes(1)
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should render app detail content without owning the main skip target', async () => {
    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })

  it('should redirect restricted app pages before exposing app detail content', async () => {
    mockPathname = '/app/app-1/logs'
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }),
    )

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

  it('should redirect logs pages when log and annotation access is missing', async () => {
    mockPathname = '/app/app-1/logs'
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.Monitor] }),
    )

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

  it('should allow users with log and annotation access to open logs directly', async () => {
    mockPathname = '/app/app-1/logs'
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.LogAndAnnotation] }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalled()
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should allow users with Access Point view permission to open the page directly', async () => {
    mockPathname = '/app/app-1/access-point'
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.AccessPointView] }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalled()
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should redirect access point pages when view permission is missing', async () => {
    mockPathname = '/app/app-1/access-point'
    mockAppResponse.mockResolvedValue(createAppDetail({ permission_keys: [] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should keep cached Access Point content hidden while redirecting without view permission', async () => {
    mockPathname = '/app/app-1/access-point'
    useStore.getState().setAppDetail(createAppDetail({ permission_keys: [] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
    expect(mockAppResponse).not.toHaveBeenCalled()
  })

  it('should redirect deploy pages when app deploy ACL permission is missing', async () => {
    mockPathname = '/app/app-1/deploy'
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }),
    )

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

  it('should allow users with app deploy ACL permission to open deploy directly', async () => {
    mockPathname = '/app/app-1/deploy'
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.Deploy] }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalled()
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
    mockAppResponse.mockResolvedValue(createAppDetail({ permission_keys: [] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should redirect overview pages when monitor access is missing', async () => {
    mockPathname = '/app/app-1/overview'
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }),
    )

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
    mockConsoleState.isLoadingWorkspacePermissionKeys = true
    mockPathname = '/app/app-1/overview'
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }),
    )

    const { rerender } = render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockAppResponse).toHaveBeenCalledTimes(1)
    })
    expect(mockReplace).not.toHaveBeenCalled()
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()

    mockConsoleState.isLoadingWorkspacePermissionKeys = false
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
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.Monitor] }),
    )

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
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.ViewLayout] }),
    )

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
    mockAppResponse.mockResolvedValue(
      createAppDetail({ permission_keys: [AppACLPermission.AccessConfig] }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockReplace).not.toHaveBeenCalled()
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should redirect Agent app access config URLs to the Agent configure page', async () => {
    mockPathname = '/app/app-1/access-config'
    mockAppResponse.mockResolvedValue(
      createAppDetail({
        mode: AppModeEnum.AGENT,
        bound_agent_id: 'agent-1',
        permission_keys: [AppACLPermission.AccessConfig],
      }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/agents/agent-1/configure')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should keep Agent app access config content hidden while redirecting cached app data', async () => {
    mockPathname = '/app/app-1/access-config'
    useStore.getState().setAppDetail(
      createAppDetail({
        mode: AppModeEnum.AGENT,
        bound_agent_id: 'agent-1',
        permission_keys: [AppACLPermission.AccessConfig],
      }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/agents/agent-1/configure')
    })
    expect(mockAppResponse).not.toHaveBeenCalled()
  })

  it('should redirect access config pages when RBAC is disabled', async () => {
    mockIsRbacEnabled = false
    mockPathname = '/app/app-1/access-config'
    mockAppResponse.mockResolvedValue(
      createAppDetail({
        permission_keys: [AppACLPermission.AccessConfig, AppACLPermission.AccessPointView],
      }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/access-point')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('should redirect annotation pages when log and annotation access is missing', async () => {
    mockPathname = '/app/app-1/annotations'
    mockAppResponse.mockResolvedValue(
      createAppDetail({
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.Monitor],
      }),
    )

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

  it('should allow users with log and annotation access to open annotations directly', async () => {
    mockPathname = '/app/app-1/annotations'
    mockAppResponse.mockResolvedValue(
      createAppDetail({
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.LogAndAnnotation],
      }),
    )

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
