import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { useSuspenseQuery } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import AppDetailLayout from '../layout-main'

const mockAppResponse = vi.fn()
let mockPathname = '/app/app-1/workflow'
let mockIsRbacEnabled = true
let permissionsPending = false
let resolvePermissions: (() => void) | undefined
const mockNavigation = vi.hoisted(() => ({
  usePathname: vi.fn(),
  // Like Next.js, a redirect stops rendering the current route.
  redirect: vi.fn((): never => {
    throw new Promise(() => {})
  }),
}))

const render = (
  ui: Parameters<typeof renderWithConsoleQuery>[0],
  { cachedAppDetail }: { cachedAppDetail?: AppDetailWithSite } = {},
) => {
  const queryClient = createConsoleQueryClient()
  if (cachedAppDetail) seedAppDetail(queryClient, cachedAppDetail)
  return renderWithConsoleQuery(ui, {
    queryClient,
    currentWorkspace: { id: 'workspace-1' },
    accountProfile: { id: 'user-1' },
    workspacePermissionKeys: permissionsPending ? null : [],
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
  })
}

vi.mock('@/next/navigation', () => mockNavigation)

const mockUsePathname = mockNavigation.usePathname
const mockRedirect = mockNavigation.redirect

const createAppDetail = (overrides: Partial<AppDetailWithSite> = {}) =>
  createAppDetailFixture({
    id: 'app-1',
    name: 'Demo App',
    mode: 'workflow' as const,
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
    permissionsPending = false
    resolvePermissions = undefined
    mockUsePathname.mockImplementation(() => mockPathname)
    mockAppResponse.mockResolvedValue(createAppDetail())
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      const path = new URL(url).pathname
      if (path.includes('/rbac/')) {
        await new Promise<void>((resolve) => {
          resolvePermissions = resolve
        })
        return Response.json({
          workspace: { permission_keys: [] },
          app: { default_permission_keys: [], overrides: [] },
          dataset: { default_permission_keys: [], overrides: [] },
        })
      }
      if (!/\/apps\/app-[12]$/.test(path)) throw new Error(`Unexpected request: ${url}`)
      const response = await mockAppResponse(url)
      return response instanceof Response ? response : Response.json(response)
    })
  })

  it('shares the app detail request with the overview observer', async () => {
    mockPathname = '/app/app-1/overview'
    function OverviewConsumer() {
      const { data } = useSuspenseQuery(
        consoleQuery.apps.byAppId.get.queryOptions({
          input: { params: { app_id: 'app-1' } },
        }),
      )
      return <div>{data.name} statistics</div>
    }
    render(
      <AppDetailLayout appId="app-1">
        <Suspense fallback={<div>Loading overview</div>}>
          <OverviewConsumer />
        </Suspense>
      </AppDetailLayout>,
    )
    expect(await screen.findByText('Demo App statistics')).toBeInTheDocument()
    expect(mockAppResponse).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Loading overview')).not.toBeInTheDocument()
  })

  it('hides the previous app while loading another app', async () => {
    const { rerender } = render(
      <AppDetailLayout appId="app-1">
        <div>First app content</div>
      </AppDetailLayout>,
    )
    await screen.findByText('First app content')
    let resolveRequest!: (response: AppDetailWithSite) => void
    mockAppResponse.mockImplementation(
      () =>
        new Promise<AppDetailWithSite>((resolve) => {
          resolveRequest = resolve
        }),
    )
    mockPathname = '/app/app-2/workflow'
    rerender(
      <AppDetailLayout appId="app-2">
        <div>Second app content</div>
      </AppDetailLayout>,
    )
    expect(screen.queryByText('First app content')).not.toBeInTheDocument()
    expect(screen.queryByText('Second app content')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(mockAppResponse).toHaveBeenCalledWith(expect.stringMatching(/\/apps\/app-2$/)),
    )
    await act(async () => {
      resolveRequest(createAppDetail({ id: 'app-2' }))
    })
    expect(await screen.findByText('Second app content')).toBeInTheDocument()
  })

  describe('Document title', () => {
    it.each([
      ['/app/app-1/workflow', 'common.appMenus.promptEng', 'workflow'],
      ['/app/app-1/configuration', 'common.appMenus.promptEng', 'chat'],
      ['/app/app-1/access-point', 'common.appMenus.accessPoint', 'workflow'],
      ['/app/app-1/deploy', 'common.appMenus.deploy', 'workflow'],
      ['/app/app-1/logs', 'common.appMenus.logs', 'workflow'],
      ['/app/app-1/annotations', 'common.appMenus.annotations', 'chat'],
      ['/app/app-1/overview', 'common.appMenus.overview', 'workflow'],
      ['/app/app-1/access-config', 'navigation.settings.resourceAccess', 'workflow'],
    ] as const)('identifies the current detail page for %s', async (pathname, pageTitle, mode) => {
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

    it('updates after a directly loaded app is renamed in the query cache', async () => {
      const { queryClient } = render(
        <AppDetailLayout appId="app-1">
          <div>App page content</div>
        </AppDetailLayout>,
      )

      await waitFor(() => {
        expect(document.title).toBe('common.appMenus.promptEng · Demo App - Dify')
      })

      act(() => {
        queryClient.setQueryData(
          consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
          createAppDetail({ name: 'Renamed App' }),
        )
      })

      await waitFor(() => {
        expect(document.title).toBe('common.appMenus.promptEng · Renamed App - Dify')
      })
      expect(mockAppResponse).toHaveBeenCalled()
    })
  })

  it('redirects a deleted app after the generated transport returns not found', async () => {
    mockAppResponse.mockImplementation(async () =>
      Response.json({ message: 'App not found' }, { status: 404 }),
    )
    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/apps'))
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
  })

  it('should keep app detail data when navigating between pages in the same app', async () => {
    const { rerender } = render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )
    await waitForAppContent()
    expect(mockAppResponse).toHaveBeenCalledWith(expect.stringMatching(/\/apps\/app-1$/))

    mockPathname = '/app/app-1/overview'
    rerender(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    expect(screen.getByText('App page content')).toBeInTheDocument()
    expect(mockAppResponse).toHaveBeenCalledTimes(1)
  })

  it('renders cached app detail content on the first render without a loading frame', () => {
    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
      { cachedAppDetail: createAppDetail() },
    )

    expect(screen.getByText('App page content')).toBeInTheDocument()
    expect(mockRedirect).not.toHaveBeenCalled()
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
      expect(mockRedirect).toHaveBeenCalledWith('/app/app-1/workflow')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
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
      expect(mockRedirect).toHaveBeenCalledWith('/app/app-1/overview')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
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

    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it.each(['workflow', 'agent-chat'] as const)(
    'should allow users with Access Point view permission to open a %s page directly',
    async (mode) => {
      mockPathname = '/app/app-1/access-point'
      mockAppResponse.mockResolvedValue(
        createAppDetail({ mode, permission_keys: [AppACLPermission.AccessPointView] }),
      )

      render(
        <AppDetailLayout appId="app-1">
          <div>App page content</div>
        </AppDetailLayout>,
      )

      await waitForAppContent()

      expect(mockRedirect).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      source: 'fetched Agent',
      cached: false,
      agentId: 'agent-1',
      destination: '/agents/agent-1/access',
    },
    {
      source: 'cached Agent',
      cached: true,
      agentId: 'agent-1',
      destination: '/agents/agent-1/access',
    },
    { source: 'unbound Agent', cached: false, agentId: null, destination: '/agents' },
  ])(
    'redirects the legacy Access Point URL for a $source without rendering generic app content',
    async ({ cached, agentId, destination }) => {
      mockPathname = '/app/app-1/access-point'
      const agentApp = createAppDetail({
        mode: 'agent',
        bound_agent_id: agentId,
        permission_keys: [AppACLPermission.AccessPointView],
      })
      mockAppResponse.mockResolvedValue(agentApp)

      render(
        <AppDetailLayout appId="app-1">
          <div>App page content</div>
        </AppDetailLayout>,
        { cachedAppDetail: cached ? agentApp : undefined },
      )

      expect(screen.queryByText('App page content')).not.toBeInTheDocument()
      await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith(destination))
      expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    },
  )

  it('should redirect access point pages when view permission is missing', async () => {
    mockPathname = '/app/app-1/access-point'
    mockAppResponse.mockResolvedValue(createAppDetail({ permission_keys: [] }))

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith('/apps')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
  })

  it('should keep cached Access Point content hidden while redirecting without view permission', async () => {
    mockPathname = '/app/app-1/access-point'

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
      { cachedAppDetail: createAppDetail({ permission_keys: [] }) },
    )

    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith('/apps')
    })
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
      expect(mockRedirect).toHaveBeenCalledWith('/app/app-1/workflow')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
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

    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('should allow users with layout access to open workflow pages directly', async () => {
    mockPathname = '/app/app-1/workflow'

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockRedirect).not.toHaveBeenCalled()
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
      expect(mockRedirect).toHaveBeenCalledWith('/apps')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
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
      expect(mockRedirect).toHaveBeenCalledWith('/app/app-1/workflow')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
  })

  it('should wait for workspace permission keys before redirecting restricted pages', async () => {
    permissionsPending = true
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
      expect(mockAppResponse).toHaveBeenCalled()
    })
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()

    await waitFor(() => expect(resolvePermissions).toBeDefined())
    await act(async () => {
      resolvePermissions!()
    })

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith('/app/app-1/workflow')
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

    expect(mockRedirect).not.toHaveBeenCalled()
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
      expect(mockRedirect).toHaveBeenCalledWith('/app/app-1/workflow')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
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

    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('should redirect Agent app access config URLs to the Agent configure page', async () => {
    mockPathname = '/app/app-1/access-config'
    mockAppResponse.mockResolvedValue(
      createAppDetail({
        mode: 'agent' as const,
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
      expect(mockRedirect).toHaveBeenCalledWith('/agents/agent-1/configure')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
  })

  it('should keep Agent app access config content hidden while redirecting cached app data', async () => {
    mockPathname = '/app/app-1/access-config'

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
      {
        cachedAppDetail: createAppDetail({
          mode: 'agent' as const,
          bound_agent_id: 'agent-1',
          permission_keys: [AppACLPermission.AccessConfig],
        }),
      },
    )

    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith('/agents/agent-1/configure')
    })
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
      expect(mockRedirect).toHaveBeenCalledWith('/app/app-1/access-point')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
  })

  it('should redirect annotation pages when log and annotation access is missing', async () => {
    mockPathname = '/app/app-1/annotations'
    mockAppResponse.mockResolvedValue(
      createAppDetail({
        mode: 'chat' as const,
        permission_keys: [AppACLPermission.Monitor],
      }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith('/app/app-1/overview')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
  })

  it('should allow users with log and annotation access to open annotations directly', async () => {
    mockPathname = '/app/app-1/annotations'
    mockAppResponse.mockResolvedValue(
      createAppDetail({
        mode: 'chat' as const,
        permission_keys: [AppACLPermission.LogAndAnnotation],
      }),
    )

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()

    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it.each([
    ['agent-1', '/agents/agent-1/access'],
    [null, '/agents'],
  ])(
    'redirects legacy Agent access-point URLs to the Agent owner (%s)',
    async (boundAgentId, target) => {
      mockPathname = '/app/app-1/access-point'
      mockAppResponse.mockResolvedValue(
        createAppDetail({
          mode: 'agent',
          bound_agent_id: boundAgentId,
          permission_keys: [AppACLPermission.AccessPointView],
        }),
      )
      render(
        <AppDetailLayout appId="app-1">
          <div>App page content</div>
        </AppDetailLayout>,
      )
      await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith(target))
      expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    },
  )
})
