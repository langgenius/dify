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
    isPending: false,
  },
  webCard: vi.fn(),
  apiCard: vi.fn(),
  mcpCard: vi.fn(),
  triggerCard: vi.fn(),
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

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()
  return {
    ...actual,
    useAtomValue: () => undefined,
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
  useAppWorkflow: () => mocks.workflow,
}))

vi.mock('@/utils/permission', () => ({
  getAppACLCapabilities: () => ({
    canEdit: false,
    canDeploy: true,
    canReleaseAndVersion: false,
  }),
}))

vi.mock('../use-built-in-actions', () => ({
  useBuiltInAccessPointActions: () => ({
    changeApiStatus: vi.fn(),
    changeSiteStatus: vi.fn(),
    handleResult: vi.fn(),
    refreshAppDetail: vi.fn(),
    regenerateSiteCode: vi.fn(),
    saveSiteConfig: vi.fn(),
  }),
}))

vi.mock('../web-app-card', () => ({
  WebAppAccessPointCard: (props: Record<string, unknown>) => {
    mocks.webCard(props)
    return <div data-testid="web-app-card" />
  },
}))

vi.mock('../service-api-card', () => ({
  ServiceApiAccessPointCard: (props: Record<string, unknown>) => {
    mocks.apiCard(props)
    return <div data-testid="service-api-card" />
  },
}))

vi.mock('../mcp-card', () => ({
  MCPAccessPointCard: (props: Record<string, unknown>) => {
    mocks.mcpCard(props)
    return <div data-testid="mcp-card" />
  },
}))

vi.mock('../trigger-card', () => ({
  TriggerAccessPointCard: (props: Record<string, unknown>) => {
    mocks.triggerCard(props)
    return <div data-testid="trigger-card" />
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
      isPending: false,
    }
  })

  it('renders the unpublished state across all access point cards', () => {
    render(<BuiltInAccessPoints appId="app-1" />)

    expect(screen.getByText('deployments.studio.accessPoint.noPublishedTitle')).toBeInTheDocument()
    expect(screen.getByTestId('web-app-card')).toBeInTheDocument()
    expect(screen.getByTestId('service-api-card')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-card')).toBeInTheDocument()
    expect(screen.getByTestId('trigger-card')).toBeInTheDocument()
    expect(mocks.webCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable', canDeploy: true, canEdit: false }),
    )
    expect(mocks.apiCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable', canEdit: false }),
    )
    expect(mocks.triggerCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable', canEdit: false }),
    )
  })

  it('renders service cards as available when a published Start node exists', () => {
    mocks.workflow = {
      data: {
        graph: {
          nodes: [{ data: { type: 'start' } }],
        },
      },
      isPending: false,
    }

    render(<BuiltInAccessPoints appId="app-1" />)

    expect(
      screen.queryByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).not.toBeInTheDocument()
    expect(mocks.webCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'available' }),
    )
    expect(mocks.apiCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'available' }),
    )
    expect(mocks.triggerCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'unavailable' }),
    )
  })

  it('highlights only the targeted built-in access point card', () => {
    render(<BuiltInAccessPoints appId="app-1" highlightedAccessPoint="mcp" />)

    expect(mocks.webCard).toHaveBeenCalledWith(expect.objectContaining({ highlighted: false }))
    expect(mocks.apiCard).toHaveBeenCalledWith(expect.objectContaining({ highlighted: false }))
    expect(mocks.mcpCard).toHaveBeenCalledWith(expect.objectContaining({ highlighted: true }))
    expect(mocks.triggerCard).toHaveBeenCalledWith(expect.objectContaining({ highlighted: false }))
  })

  it('enables Trigger and disables the other access points in trigger mode', () => {
    mocks.workflow = {
      data: {
        graph: {
          nodes: [{ data: { type: 'start' } }, { data: { type: 'trigger-webhook' } }],
        },
      },
      isPending: false,
    }

    render(<BuiltInAccessPoints appId="app-1" />)

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
      isPending: true,
    }

    render(<BuiltInAccessPoints appId="app-1" />)

    expect(mocks.webCard).toHaveBeenCalledWith(expect.objectContaining({ availability: 'loading' }))
    expect(mocks.apiCard).toHaveBeenCalledWith(expect.objectContaining({ availability: 'loading' }))
    expect(mocks.triggerCard).toHaveBeenCalledWith(
      expect.objectContaining({ availability: 'loading' }),
    )
  })
})
