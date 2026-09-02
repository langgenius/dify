import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { BuiltInAccessPoints } from '../built-in-access-points'

const mocks = vi.hoisted(() => ({
  appInfo: {
    id: 'app-1',
    mode: 'workflow',
    enable_site: false,
    enable_api: false,
    permission_keys: [],
  } as Record<string, unknown>,
  workflow: {
    data: null as Record<string, unknown> | null,
    isError: false,
    isPending: false,
  },
  webCard: vi.fn(),
  apiCard: vi.fn(),
  mcpCard: vi.fn(),
  triggerCard: vi.fn(),
  useAppWorkflow: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock()
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useSuspenseQuery: () => ({
      data: {
        webapp_auth: { enabled: true },
      },
    }),
  }
})

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ appDetail: mocks.appInfo }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: (...args: unknown[]) => {
    mocks.useAppWorkflow(...args)
    return mocks.workflow
  },
}))

vi.mock('../shared/use-access-point-actions', () => ({
  useAccessPointActions: () => ({
    handleAppStateChanged: vi.fn(),
    handleResult: vi.fn(),
    refreshAppDetail: vi.fn(),
    saveSiteConfig: vi.fn(),
  }),
}))

vi.mock('../built-in-access-points/web-app-card', () => ({
  WebAppAccessPointCard: (props: Record<string, unknown>) => {
    mocks.webCard(props)
    return null
  },
}))

vi.mock('../built-in-access-points/service-api-card', () => ({
  ServiceApiAccessPointCard: (props: Record<string, unknown>) => {
    mocks.apiCard(props)
    return null
  },
}))

vi.mock('../built-in-access-points/mcp-card', () => ({
  MCPAccessPointCard: (props: Record<string, unknown>) => {
    mocks.mcpCard(props)
    return null
  },
}))

vi.mock('../built-in-access-points/trigger-card', () => ({
  TriggerAccessPointCard: (props: Record<string, unknown>) => {
    mocks.triggerCard(props)
    return null
  },
}))

describe('BuiltInAccessPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appInfo = {
      id: 'app-1',
      mode: 'workflow',
      enable_site: false,
      enable_api: false,
      permission_keys: [],
    }
    mocks.workflow = {
      data: null,
      isError: false,
      isPending: false,
    }
  })

  it('renders the unpublished state across all access point cards', () => {
    render(
      <BuiltInAccessPoints
        appId="app-1"
        canDeploy
        canManageAccessPoint={false}
        canReleaseAndVersion={false}
      />,
    )

    expect(screen.getByText('deployments.studio.accessPoint.noPublishedTitle')).toBeInTheDocument()
    expect(mocks.webCard).toHaveBeenCalledWith(
      expect.objectContaining({
        availability: 'unavailable',
        canDeploy: true,
        canManageAccessPoint: false,
      }),
    )
    expect(mocks.apiCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable', canManage: false }),
    )
    expect(mocks.mcpCard).toHaveBeenCalledTimes(1)
    expect(mocks.triggerCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable', canManageAccessPoint: false }),
    )
  })

  it('keeps Trigger unavailable when no trigger node is published', () => {
    mocks.workflow = {
      data: {
        graph: {
          nodes: [{ data: { type: 'start' } }],
        },
      },
      isError: false,
      isPending: false,
    }

    render(
      <BuiltInAccessPoints
        appId="app-1"
        canDeploy
        canManageAccessPoint={false}
        canReleaseAndVersion={false}
      />,
    )

    expect(
      screen.queryByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).not.toBeInTheDocument()
    expect(mocks.webCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'available', workflow: mocks.workflow.data }),
    )
    expect(mocks.apiCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'available' }),
    )
    expect(mocks.triggerCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable' }),
    )
  })

  it('uses Access Point management for every requested built-in operation', () => {
    render(
      <BuiltInAccessPoints
        appId="app-1"
        canDeploy
        canManageAccessPoint
        canReleaseAndVersion={false}
      />,
    )

    expect(mocks.webCard).toHaveBeenCalledWith(
      expect.objectContaining({ canManageAccess: false, canManageAccessPoint: true }),
    )
    expect(mocks.apiCard).toHaveBeenCalledWith(expect.objectContaining({ canManage: true }))
    expect(mocks.mcpCard).toHaveBeenCalledWith(
      expect.objectContaining({ canManageAccessPoint: true }),
    )
    expect(mocks.triggerCard).toHaveBeenCalledWith(
      expect.objectContaining({ canManageAccessPoint: true }),
    )
  })

  it('highlights only the targeted built-in access point card', () => {
    render(
      <BuiltInAccessPoints
        appId="app-1"
        canDeploy
        canManageAccessPoint
        canReleaseAndVersion
        highlightedAccessPoint="mcp"
      />,
    )

    expect(mocks.webCard).toHaveBeenCalledWith(expect.objectContaining({ highlighted: false }))
    expect(mocks.apiCard).toHaveBeenCalledWith(expect.objectContaining({ highlighted: false }))
    expect(mocks.mcpCard).toHaveBeenCalledWith(expect.objectContaining({ highlighted: true }))
    expect(mocks.triggerCard).toHaveBeenCalledWith(expect.objectContaining({ highlighted: false }))
  })

  it('enables Trigger and disables the other access points in trigger mode', () => {
    mocks.workflow = {
      data: {
        graph: {
          nodes: [{ data: { type: 'trigger-webhook' } }],
        },
      },
      isError: false,
      isPending: false,
    }

    render(
      <BuiltInAccessPoints appId="app-1" canDeploy canManageAccessPoint canReleaseAndVersion />,
    )

    expect(mocks.webCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable' }),
    )
    expect(mocks.apiCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable' }),
    )
    expect(mocks.mcpCard).toHaveBeenCalledWith(
      expect.objectContaining({ triggerModeDisabled: true }),
    )
    expect(mocks.triggerCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'available' }),
    )
    expect(
      screen.getByText('deployments.studio.accessPoint.triggerExclusiveNotice'),
    ).toBeInTheDocument()
  })

  it('keeps all cards visible while the published workflow is loading', () => {
    mocks.workflow = {
      data: null,
      isError: false,
      isPending: true,
    }

    render(
      <BuiltInAccessPoints appId="app-1" canDeploy canManageAccessPoint canReleaseAndVersion />,
    )

    expect(mocks.webCard).toHaveBeenCalledWith(expect.objectContaining({ availability: 'loading' }))
    expect(mocks.apiCard).toHaveBeenCalledWith(expect.objectContaining({ availability: 'loading' }))
    expect(mocks.triggerCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'loading' }),
    )
  })

  it('does not show the unpublished card when loading the published workflow fails', () => {
    mocks.workflow = {
      data: null,
      isError: true,
      isPending: false,
    }

    render(
      <BuiltInAccessPoints appId="app-1" canDeploy canManageAccessPoint canReleaseAndVersion />,
    )

    expect(
      screen.queryByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).not.toBeInTheDocument()
  })

  it('does not retry forbidden published workflow requests', () => {
    render(
      <BuiltInAccessPoints appId="app-1" canDeploy canManageAccessPoint canReleaseAndVersion />,
    )

    const options = mocks.useAppWorkflow.mock.calls.at(-1)?.[1] as {
      retry: (failureCount: number, error: unknown) => boolean
    }

    expect(options.retry(0, new Response(null, { status: 403 }))).toBe(false)
    expect(options.retry(0, new Response(null, { status: 500 }))).toBe(true)
    expect(options.retry(3, new Response(null, { status: 500 }))).toBe(false)
  })
})
