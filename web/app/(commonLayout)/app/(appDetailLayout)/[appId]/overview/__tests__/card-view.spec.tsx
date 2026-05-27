import type { App } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CardView from '../card-view'

const mockAppState = vi.hoisted(() => ({
  appDetail: {
    id: 'app-1',
    mode: 'chat',
    permission_keys: [] as string[],
  },
  setAppDetail: vi.fn(),
}))

const mockUpdateAppSiteStatus = vi.hoisted(() => vi.fn())
const mockUpdateAppSiteConfig = vi.hoisted(() => vi.fn())
const mockUpdateAppSiteAccessToken = vi.hoisted(() => vi.fn())
const mockInvalidateQueries = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: typeof mockAppState) => T): T => selector(mockAppState),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({ data: undefined }),
}))

vi.mock('@/service/apps', () => ({
  updateAppSiteStatus: (...args: unknown[]) => mockUpdateAppSiteStatus(...args),
  updateAppSiteConfig: (...args: unknown[]) => mockUpdateAppSiteConfig(...args),
  updateAppSiteAccessToken: (...args: unknown[]) => mockUpdateAppSiteAccessToken(...args),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onAppStateUpdate: vi.fn(() => vi.fn()),
  },
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: {
    getSocket: vi.fn(() => null),
  },
}))

vi.mock('@/app/components/app/overview/app-card', () => ({
  default: ({
    cardType,
    onChangeStatus,
    onGenerateCode,
    onSaveSiteConfig,
  }: {
    cardType: string
    onChangeStatus?: (value: boolean) => void
    onGenerateCode?: () => void
    onSaveSiteConfig?: (params: Record<string, unknown>) => void
  }) => (
    <div>
      <button type="button" onClick={() => onChangeStatus?.(true)}>
        toggle
        {' '}
        {cardType}
      </button>
      {onGenerateCode && (
        <button type="button" onClick={() => onGenerateCode()}>
          generate
          {' '}
          {cardType}
        </button>
      )}
      {onSaveSiteConfig && (
        <button type="button" onClick={() => onSaveSiteConfig({ title: 'Site title' })}>
          save
          {' '}
          {cardType}
        </button>
      )}
    </div>
  ),
}))

vi.mock('@/app/components/app/overview/trigger-card', () => ({
  default: () => <div>trigger card</div>,
}))

vi.mock('@/app/components/tools/mcp/mcp-service-card', () => ({
  default: () => <div>mcp card</div>,
}))

describe('CardView ACL edit guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppState.appDetail = {
      id: 'app-1',
      mode: 'chat',
      permission_keys: [],
    }
    mockUpdateAppSiteStatus.mockResolvedValue(mockAppState.appDetail as App)
    mockUpdateAppSiteConfig.mockResolvedValue(mockAppState.appDetail as App)
    mockUpdateAppSiteAccessToken.mockResolvedValue({ code: 'token' })
    mockInvalidateQueries.mockResolvedValue(undefined)
  })

  // User-facing card actions should not mutate app settings without app ACL edit permission.
  describe('Permissions', () => {
    it('should not call write APIs when app ACL edit permission is missing', async () => {
      const user = userEvent.setup()

      render(<CardView appId="app-1" />)

      await user.click(screen.getByRole('button', { name: /toggle webapp/ }))
      await user.click(screen.getByRole('button', { name: /save webapp/ }))
      await user.click(screen.getByRole('button', { name: /generate webapp/ }))
      await user.click(screen.getByRole('button', { name: /toggle api/ }))

      expect(mockUpdateAppSiteStatus).not.toHaveBeenCalled()
      expect(mockUpdateAppSiteConfig).not.toHaveBeenCalled()
      expect(mockUpdateAppSiteAccessToken).not.toHaveBeenCalled()
    })

    it('should call write APIs when app ACL edit permission is present', async () => {
      const user = userEvent.setup()
      mockAppState.appDetail.permission_keys = ['app.acl.edit']

      render(<CardView appId="app-1" />)

      await user.click(screen.getByRole('button', { name: /toggle webapp/ }))
      await user.click(screen.getByRole('button', { name: /save webapp/ }))
      await user.click(screen.getByRole('button', { name: /generate webapp/ }))
      await user.click(screen.getByRole('button', { name: /toggle api/ }))

      await waitFor(() => {
        expect(mockUpdateAppSiteStatus).toHaveBeenCalledTimes(2)
      })
      expect(mockUpdateAppSiteStatus).toHaveBeenCalledWith({
        url: '/apps/app-1/site-enable',
        body: { enable_site: true },
      })
      expect(mockUpdateAppSiteStatus).toHaveBeenCalledWith({
        url: '/apps/app-1/api-enable',
        body: { enable_api: true },
      })
      expect(mockUpdateAppSiteConfig).toHaveBeenCalledWith({
        url: '/apps/app-1/site',
        body: { title: 'Site title' },
      })
      expect(mockUpdateAppSiteAccessToken).toHaveBeenCalledWith({
        url: '/apps/app-1/site/access-token-reset',
      })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['apps', 'detail', 'app-1'] })
    })
  })
})
