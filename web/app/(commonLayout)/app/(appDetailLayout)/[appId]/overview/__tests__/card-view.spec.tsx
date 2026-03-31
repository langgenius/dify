import type { App } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import CardView from '../card-view'

const mockToast = vi.fn()
const mockFetchAppDetail = vi.fn()
const mockUpdateAppSiteStatus = vi.fn()
const mockUpdateAppSiteConfig = vi.fn()
const mockUpdateAppSiteAccessToken = vi.fn()
const mockSocketEmit = vi.fn()
const mockGetSocket = vi.fn()
const mockOnAppStateUpdate = vi.fn()

const cardState = vi.hoisted(() => ({
  appDetail: null as null | { id: string, mode: string, name?: string },
  workflow: null as null | { graph?: { nodes?: Array<{ data?: { type?: string } }> } },
  setAppDetail: vi.fn(),
  collaborationCallback: null as null | (() => Promise<void>),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: typeof cardState.appDetail, setAppDetail: typeof cardState.setAppDetail }) => unknown) => selector({
    appDetail: cardState.appDetail,
    setAppDetail: cardState.setAppDetail,
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({ data: cardState.workflow }),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div>loading</div>,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

vi.mock('@/app/components/app/overview/app-card', () => ({
  default: ({
    cardType,
    triggerModeDisabled,
    onChangeStatus,
    onGenerateCode,
    onSaveSiteConfig,
  }: {
    cardType: string
    triggerModeDisabled?: boolean
    onChangeStatus?: (value: boolean) => void
    onGenerateCode?: () => void
    onSaveSiteConfig?: (params: Record<string, string>) => void
  }) => (
    <div>
      <div>{`app-card:${cardType}:${triggerModeDisabled ? 'disabled' : 'enabled'}`}</div>
      {onChangeStatus && <button type="button" onClick={() => onChangeStatus(true)}>{`toggle:${cardType}`}</button>}
      {onGenerateCode && <button type="button" onClick={onGenerateCode}>{`generate:${cardType}`}</button>}
      {onSaveSiteConfig && <button type="button" onClick={() => onSaveSiteConfig({ title: 'site-title' })}>{`save-config:${cardType}`}</button>}
    </div>
  ),
}))

vi.mock('@/app/components/app/overview/trigger-card', () => ({
  default: ({ onToggleResult }: { onToggleResult: (error: Error | null, message?: string) => void }) => (
    <button type="button" onClick={() => onToggleResult(null, 'generatedSuccessfully')}>trigger-card</button>
  ),
}))

vi.mock('@/app/components/tools/mcp/mcp-service-card', () => ({
  default: ({ triggerModeDisabled }: { triggerModeDisabled?: boolean }) => <div>{`mcp-card:${triggerModeDisabled ? 'disabled' : 'enabled'}`}</div>,
}))

vi.mock('@/app/components/workflow/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/types')>()
  return {
    ...actual,
    isTriggerNode: (type: string) => type === 'trigger',
  }
})

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: {
    getSocket: (...args: unknown[]) => mockGetSocket(...args),
  },
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onAppStateUpdate: (...args: unknown[]) => mockOnAppStateUpdate(...args),
  },
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetail: (...args: unknown[]) => mockFetchAppDetail(...args),
  updateAppSiteStatus: (...args: unknown[]) => mockUpdateAppSiteStatus(...args),
  updateAppSiteConfig: (...args: unknown[]) => mockUpdateAppSiteConfig(...args),
  updateAppSiteAccessToken: (...args: unknown[]) => mockUpdateAppSiteAccessToken(...args),
}))

const createApp = (overrides: Partial<App> = {}): App => ({
  id: 'app-1',
  mode: 'chat',
  name: 'App 1',
  description: '',
  icon: '',
  icon_background: '',
  icon_type: 'emoji',
  enable_site: false,
  enable_api: false,
  created_at: 0,
  updated_at: 0,
  ...overrides,
} as App)

describe('OverviewRouteCardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cardState.appDetail = null
    cardState.workflow = null
    cardState.collaborationCallback = null
    cardState.setAppDetail.mockReset()
    mockFetchAppDetail.mockResolvedValue(createApp({ mode: AppModeEnum.CHAT }))
    mockUpdateAppSiteStatus.mockResolvedValue(createApp())
    mockUpdateAppSiteConfig.mockResolvedValue(createApp())
    mockUpdateAppSiteAccessToken.mockResolvedValue({ access_token: 'token-1' })
    mockGetSocket.mockReturnValue({ emit: mockSocketEmit })
    mockOnAppStateUpdate.mockImplementation((callback: () => Promise<void>) => {
      cardState.collaborationCallback = callback
      return vi.fn()
    })
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render loading when app details are unavailable', () => {
    render(<CardView appId="app-1" />)

    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('should render workflow trigger mode cards inside the panel', () => {
    cardState.appDetail = { id: 'app-1', mode: AppModeEnum.WORKFLOW }
    cardState.workflow = { graph: { nodes: [{ data: { type: 'trigger' } }] } }

    render(<CardView appId="app-1" isInPanel={true} />)

    expect(screen.getByText('app-card:webapp:disabled')).toBeInTheDocument()
    expect(screen.getByText('app-card:api:disabled')).toBeInTheDocument()
    expect(screen.getByText('mcp-card:disabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'trigger-card' })).toBeInTheDocument()
  })

  it('should disable app cards while workflow details are still loading', () => {
    cardState.appDetail = { id: 'app-1', mode: AppModeEnum.WORKFLOW }
    cardState.workflow = null

    render(<CardView appId="app-1" isInPanel={true} />)

    expect(screen.getByText('app-card:webapp:disabled')).toBeInTheDocument()
    expect(screen.getByText('app-card:api:disabled')).toBeInTheDocument()
    expect(screen.getByText('mcp-card:disabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'trigger-card' })).toBeInTheDocument()
  })

  it('should call app actions, refresh details, and emit collaboration events on success', async () => {
    cardState.appDetail = { id: 'app-1', mode: AppModeEnum.CHAT }

    render(<CardView appId="app-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'toggle:webapp' }))
    fireEvent.click(screen.getByRole('button', { name: 'toggle:api' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-config:webapp' }))
    fireEvent.click(screen.getByRole('button', { name: 'generate:webapp' }))

    await waitFor(() => {
      expect(mockUpdateAppSiteStatus).toHaveBeenCalledWith({
        url: '/apps/app-1/site-enable',
        body: { enable_site: true },
      })
    })

    expect(mockUpdateAppSiteStatus).toHaveBeenCalledWith({
      url: '/apps/app-1/api-enable',
      body: { enable_api: true },
    })
    expect(mockUpdateAppSiteConfig).toHaveBeenCalledWith({
      url: '/apps/app-1/site',
      body: { title: 'site-title' },
    })
    expect(mockUpdateAppSiteAccessToken).toHaveBeenCalledWith({
      url: '/apps/app-1/site/access-token-reset',
    })
    expect(localStorage.getItem('needRefreshAppList')).toBe('1')
    expect(mockFetchAppDetail).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
    expect(cardState.setAppDetail).toHaveBeenCalled()
    expect(mockSocketEmit).toHaveBeenCalledWith('collaboration_event', expect.objectContaining({
      type: 'app_state_update',
    }))
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/common\.actionMsg\./), expect.objectContaining({ type: 'success' }))
  })

  it('should show an error toast when site status updates fail', async () => {
    cardState.appDetail = { id: 'app-1', mode: AppModeEnum.CHAT }
    mockUpdateAppSiteStatus.mockRejectedValueOnce(new Error('failed'))

    render(<CardView appId="app-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'toggle:webapp' }))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/common\.actionMsg\./), { type: 'error' })
    })
  })

  it('should log fetch errors when refreshing app details after successful mutations', async () => {
    const fetchError = new Error('fetch failed')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    cardState.appDetail = { id: 'app-1', mode: AppModeEnum.CHAT }
    mockFetchAppDetail.mockRejectedValue(fetchError)

    render(<CardView appId="app-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'toggle:webapp' }))

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(fetchError)
    })
  })

  it('should skip collaboration subscriptions when appId is missing', () => {
    cardState.appDetail = { id: 'app-1', mode: AppModeEnum.CHAT }

    render(<CardView appId="" />)

    expect(mockOnAppStateUpdate).not.toHaveBeenCalled()
  })

  it('should refresh details when the collaboration listener fires', async () => {
    cardState.appDetail = { id: 'app-1', mode: AppModeEnum.CHAT }

    const { unmount } = render(<CardView appId="app-1" />)

    await waitFor(() => expect(mockOnAppStateUpdate).toHaveBeenCalled())
    await cardState.collaborationCallback?.()

    expect(mockFetchAppDetail).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })

    unmount()
  })

  it('should log collaboration refresh errors when error logging fails inside the refresh helper', async () => {
    const refreshError = new Error('refresh failed')
    const loggerError = new Error('logger failed')
    const consoleErrorSpy = vi.spyOn(console, 'error')
      .mockImplementationOnce(() => {
        throw loggerError
      })
      .mockImplementation(() => {})
    cardState.appDetail = { id: 'app-1', mode: AppModeEnum.CHAT }
    mockFetchAppDetail.mockRejectedValueOnce(refreshError)

    render(<CardView appId="app-1" />)

    await waitFor(() => expect(mockOnAppStateUpdate).toHaveBeenCalled())
    await cardState.collaborationCallback?.()

    expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, refreshError)
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, 'app state update failed:', loggerError)
  })
})
