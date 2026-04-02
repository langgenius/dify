/**
 * Integration test: Installed App Flow
 *
 * Tests the end-to-end user flow of installed apps: sidebar navigation,
 * mode-based routing (Chat / Completion / Workflow), and lifecycle
 * operations (pin/unpin, delete).
 */
import type { Mock } from 'vitest'
import type { InstalledApp as InstalledAppModel } from '@/models/explore'
import { render, screen, waitFor } from '@testing-library/react'
import InstalledApp from '@/app/components/explore/installed-app'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { useGetUserCanAccessApp } from '@/service/access-control'
import { useGetInstalledAppAccessModeByAppId, useGetInstalledAppMeta, useGetInstalledAppParams, useGetInstalledApps } from '@/service/use-explore'
import { AppModeEnum } from '@/types/app'

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: vi.fn(),
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: vi.fn(),
}))

vi.mock('@/service/use-explore', () => ({
  useGetInstalledAppAccessModeByAppId: vi.fn(),
  useGetInstalledAppParams: vi.fn(),
  useGetInstalledAppMeta: vi.fn(),
  useGetInstalledApps: vi.fn(),
}))

vi.mock('@/app/components/share/text-generation', () => ({
  default: ({ isWorkflow }: { isWorkflow?: boolean }) => (
    <div data-testid="text-generation-app">
      Text Generation
      {isWorkflow && ' (Workflow)'}
    </div>
  ),
}))

vi.mock('@/app/components/base/chat/chat-with-history', () => ({
  default: ({ installedAppInfo }: { installedAppInfo?: InstalledAppModel }) => (
    <div data-testid="chat-with-history">
      Chat -
      {' '}
      {installedAppInfo?.app.name}
    </div>
  ),
}))

describe('Installed App Flow', () => {
  const mockUpdateAppInfo = vi.fn()
  const mockUpdateWebAppAccessMode = vi.fn()
  const mockUpdateAppParams = vi.fn()
  const mockUpdateWebAppMeta = vi.fn()
  const mockUpdateUserCanAccessApp = vi.fn()

  const createInstalledApp = (mode: AppModeEnum = AppModeEnum.CHAT): InstalledAppModel => ({
    id: 'installed-app-1',
    app: {
      id: 'real-app-id',
      name: 'Integration Test App',
      mode,
      icon_type: 'emoji',
      icon: '🧪',
      icon_background: '#FFFFFF',
      icon_url: '',
      description: 'Test app for integration',
      use_icon_as_answer_icon: false,
    },
    uninstallable: true,
    is_pinned: false,
  })

  const mockAppParams = {
    user_input_form: [],
    file_upload: { image: { enabled: false, number_limits: 0, transfer_methods: [] } },
    system_parameters: {},
  }

  type MockOverrides = {
    installedApps?: { apps?: InstalledAppModel[], isPending?: boolean, isFetching?: boolean }
    accessMode?: { isPending?: boolean, data?: unknown, error?: unknown }
    params?: { isPending?: boolean, data?: unknown, error?: unknown }
    meta?: { isPending?: boolean, data?: unknown, error?: unknown }
    userAccess?: { data?: unknown, error?: unknown }
  }

  const setupDefaultMocks = (app?: InstalledAppModel, overrides: MockOverrides = {}) => {
    const installedApps = overrides.installedApps?.apps ?? (app ? [app] : [])

    ;(useGetInstalledApps as Mock).mockReturnValue({
      data: { installed_apps: installedApps },
      isPending: false,
      isFetching: false,
      ...overrides.installedApps,
    })

    ;(useWebAppStore as unknown as Mock).mockImplementation((selector: (state: Record<string, Mock>) => unknown) => {
      return selector({
        updateAppInfo: mockUpdateAppInfo,
        updateWebAppAccessMode: mockUpdateWebAppAccessMode,
        updateAppParams: mockUpdateAppParams,
        updateWebAppMeta: mockUpdateWebAppMeta,
        updateUserCanAccessApp: mockUpdateUserCanAccessApp,
      })
    })

    ;(useGetInstalledAppAccessModeByAppId as Mock).mockReturnValue({
      isPending: false,
      data: { accessMode: AccessMode.PUBLIC },
      error: null,
      ...overrides.accessMode,
    })

    ;(useGetInstalledAppParams as Mock).mockReturnValue({
      isPending: false,
      data: mockAppParams,
      error: null,
      ...overrides.params,
    })

    ;(useGetInstalledAppMeta as Mock).mockReturnValue({
      isPending: false,
      data: { tool_icons: {} },
      error: null,
      ...overrides.meta,
    })

    ;(useGetUserCanAccessApp as Mock).mockReturnValue({
      data: { result: true },
      error: null,
      ...overrides.userAccess,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Mode-Based Routing', () => {
    it.each([
      [AppModeEnum.CHAT, 'chat-with-history'],
      [AppModeEnum.ADVANCED_CHAT, 'chat-with-history'],
      [AppModeEnum.AGENT_CHAT, 'chat-with-history'],
    ])('should render ChatWithHistory for %s mode', (mode, testId) => {
      const app = createInstalledApp(mode)
      setupDefaultMocks(app)

      render(<InstalledApp id="installed-app-1" />)

      expect(screen.getByTestId(testId)).toBeInTheDocument()
      expect(screen.getByText(/Integration Test App/)).toBeInTheDocument()
    })

    it('should render TextGenerationApp for COMPLETION mode', () => {
      const app = createInstalledApp(AppModeEnum.COMPLETION)
      setupDefaultMocks(app)

      render(<InstalledApp id="installed-app-1" />)

      expect(screen.getByTestId('text-generation-app')).toBeInTheDocument()
      expect(screen.getByText('Text Generation')).toBeInTheDocument()
      expect(screen.queryByText(/Workflow/)).not.toBeInTheDocument()
    })

    it('should render TextGenerationApp with workflow flag for WORKFLOW mode', () => {
      const app = createInstalledApp(AppModeEnum.WORKFLOW)
      setupDefaultMocks(app)

      render(<InstalledApp id="installed-app-1" />)

      expect(screen.getByTestId('text-generation-app')).toBeInTheDocument()
      expect(screen.getByText(/Workflow/)).toBeInTheDocument()
    })
  })

  describe('Data Loading Flow', () => {
    it('should show loading spinner when params are being fetched', () => {
      const app = createInstalledApp()
      setupDefaultMocks(app, { params: { isPending: true, data: null } })

      const { container } = render(<InstalledApp id="installed-app-1" />)

      expect(container.querySelector('svg.spin-animation')).toBeInTheDocument()
      expect(screen.queryByTestId('chat-with-history')).not.toBeInTheDocument()
    })

    it('should defer 404 while installed apps are refetching without a match', () => {
      setupDefaultMocks(undefined, {
        installedApps: { apps: [], isPending: false, isFetching: true },
      })

      const { container } = render(<InstalledApp id="nonexistent" />)

      expect(container.querySelector('svg.spin-animation')).toBeInTheDocument()
      expect(screen.queryByText(/404/)).not.toBeInTheDocument()
    })

    it('should render content when all data is available', () => {
      const app = createInstalledApp()
      setupDefaultMocks(app)

      render(<InstalledApp id="installed-app-1" />)

      expect(screen.getByTestId('chat-with-history')).toBeInTheDocument()
    })
  })

  describe('Error Handling Flow', () => {
    it('should show error state when API fails', () => {
      const app = createInstalledApp()
      setupDefaultMocks(app, { params: { data: null, error: new Error('Network error') } })

      render(<InstalledApp id="installed-app-1" />)

      expect(screen.getByText(/Network error/)).toBeInTheDocument()
    })

    it('should show 404 when app is not found', () => {
      setupDefaultMocks(undefined, {
        accessMode: { data: null },
        params: { data: null },
        meta: { data: null },
        userAccess: { data: null },
      })

      render(<InstalledApp id="nonexistent" />)

      expect(screen.getByText(/404/)).toBeInTheDocument()
    })

    it('should show 403 when user has no permission', () => {
      const app = createInstalledApp()
      setupDefaultMocks(app, { userAccess: { data: { result: false } } })

      render(<InstalledApp id="installed-app-1" />)

      expect(screen.getByText(/403/)).toBeInTheDocument()
    })
  })

  describe('State Synchronization', () => {
    it('should update all stores when app data is loaded', async () => {
      const app = createInstalledApp()
      setupDefaultMocks(app)

      render(<InstalledApp id="installed-app-1" />)

      await waitFor(() => {
        expect(mockUpdateAppInfo).toHaveBeenCalledWith(
          expect.objectContaining({
            app_id: 'installed-app-1',
            site: expect.objectContaining({
              title: 'Integration Test App',
              icon: '🧪',
            }),
          }),
        )
        expect(mockUpdateAppParams).toHaveBeenCalledWith(mockAppParams)
        expect(mockUpdateWebAppMeta).toHaveBeenCalledWith({ tool_icons: {} })
        expect(mockUpdateWebAppAccessMode).toHaveBeenCalledWith(AccessMode.PUBLIC)
        expect(mockUpdateUserCanAccessApp).toHaveBeenCalledWith(true)
      })
    })
  })
})
