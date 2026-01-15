import type { Mock } from 'vitest'
import type { InstalledApp as InstalledAppType } from '@/models/explore'
import { render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'use-context-selector'

import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { useGetUserCanAccessApp } from '@/service/access-control'
import { useGetInstalledAppAccessModeByAppId, useGetInstalledAppMeta, useGetInstalledAppParams } from '@/service/use-explore'
import { AppModeEnum } from '@/types/app'
import InstalledApp from './index'

// Mock external dependencies BEFORE imports
vi.mock('use-context-selector', () => ({
  useContext: vi.fn(),
  createContext: vi.fn(() => ({})),
}))
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
}))

/**
 * Mock child components for unit testing
 *
 * RATIONALE FOR MOCKING:
 * - TextGenerationApp: 648 lines, complex batch processing, task management, file uploads
 * - ChatWithHistory: 576-line custom hook, complex conversation/history management, 30+ context values
 *
 * These components are too complex to test as real components. Using real components would:
 * 1. Require mocking dozens of their dependencies (services, contexts, hooks)
 * 2. Make tests fragile and coupled to child component implementation details
 * 3. Violate the principle of testing one component in isolation
 *
 * For a container component like InstalledApp, its responsibility is to:
 * - Correctly route to the appropriate child component based on app mode
 * - Pass the correct props to child components
 * - Handle loading/error states before rendering children
 *
 * The internal logic of ChatWithHistory and TextGenerationApp should be tested
 * in their own dedicated test files.
 */
vi.mock('@/app/components/share/text-generation', () => ({
  default: ({ isInstalledApp, installedAppInfo, isWorkflow }: {
    isInstalledApp?: boolean
    installedAppInfo?: InstalledAppType
    isWorkflow?: boolean
  }) => (
    <div data-testid="text-generation-app">
      Text Generation App
      {isWorkflow && ' (Workflow)'}
      {isInstalledApp && ` - ${installedAppInfo?.id}`}
    </div>
  ),
}))

vi.mock('@/app/components/base/chat/chat-with-history', () => ({
  default: ({ installedAppInfo, className }: {
    installedAppInfo?: InstalledAppType
    className?: string
  }) => (
    <div data-testid="chat-with-history" className={className}>
      Chat With History -
      {' '}
      {installedAppInfo?.id}
    </div>
  ),
}))

describe('InstalledApp', () => {
  const mockUpdateAppInfo = vi.fn()
  const mockUpdateWebAppAccessMode = vi.fn()
  const mockUpdateAppParams = vi.fn()
  const mockUpdateWebAppMeta = vi.fn()
  const mockUpdateUserCanAccessApp = vi.fn()

  const mockInstalledApp = {
    id: 'installed-app-123',
    app: {
      id: 'app-123',
      name: 'Test App',
      mode: AppModeEnum.CHAT,
      icon_type: 'emoji' as const,
      icon: '🚀',
      icon_background: '#FFFFFF',
      icon_url: '',
      description: 'Test description',
      use_icon_as_answer_icon: false,
    },
    uninstallable: true,
    is_pinned: false,
  }

  const mockAppParams = {
    user_input_form: [],
    file_upload: { image: { enabled: false, number_limits: 0, transfer_methods: [] } },
    system_parameters: {},
  }

  const mockAppMeta = {
    tool_icons: {},
  }

  const mockWebAppAccessMode = {
    accessMode: AccessMode.PUBLIC,
  }

  const mockUserCanAccessApp = {
    result: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock useContext
    ;(useContext as Mock).mockReturnValue({
      installedApps: [mockInstalledApp],
      isFetchingInstalledApps: false,
    })

    // Mock useWebAppStore
    ;(useWebAppStore as unknown as Mock).mockImplementation((
      selector: (state: {
        updateAppInfo: Mock
        updateWebAppAccessMode: Mock
        updateAppParams: Mock
        updateWebAppMeta: Mock
        updateUserCanAccessApp: Mock
      }) => unknown,
    ) => {
      const state = {
        updateAppInfo: mockUpdateAppInfo,
        updateWebAppAccessMode: mockUpdateWebAppAccessMode,
        updateAppParams: mockUpdateAppParams,
        updateWebAppMeta: mockUpdateWebAppMeta,
        updateUserCanAccessApp: mockUpdateUserCanAccessApp,
      }
      return selector(state)
    })

    // Mock service hooks with default success states
    ;(useGetInstalledAppAccessModeByAppId as Mock).mockReturnValue({
      isFetching: false,
      data: mockWebAppAccessMode,
      error: null,
    })

    ;(useGetInstalledAppParams as Mock).mockReturnValue({
      isFetching: false,
      data: mockAppParams,
      error: null,
    })

    ;(useGetInstalledAppMeta as Mock).mockReturnValue({
      isFetching: false,
      data: mockAppMeta,
      error: null,
    })

    ;(useGetUserCanAccessApp as Mock).mockReturnValue({
      data: mockUserCanAccessApp,
      error: null,
    })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Chat With History/i)).toBeInTheDocument()
    })

    it('should render loading state when fetching app params', () => {
      ;(useGetInstalledAppParams as Mock).mockReturnValue({
        isFetching: true,
        data: null,
        error: null,
      })

      const { container } = render(<InstalledApp id="installed-app-123" />)
      const svg = container.querySelector('svg.spin-animation')
      expect(svg).toBeInTheDocument()
    })

    it('should render loading state when fetching app meta', () => {
      ;(useGetInstalledAppMeta as Mock).mockReturnValue({
        isFetching: true,
        data: null,
        error: null,
      })

      const { container } = render(<InstalledApp id="installed-app-123" />)
      const svg = container.querySelector('svg.spin-animation')
      expect(svg).toBeInTheDocument()
    })

    it('should render loading state when fetching web app access mode', () => {
      ;(useGetInstalledAppAccessModeByAppId as Mock).mockReturnValue({
        isFetching: true,
        data: null,
        error: null,
      })

      const { container } = render(<InstalledApp id="installed-app-123" />)
      const svg = container.querySelector('svg.spin-animation')
      expect(svg).toBeInTheDocument()
    })

    it('should render loading state when fetching installed apps', () => {
      ;(useContext as Mock).mockReturnValue({
        installedApps: [mockInstalledApp],
        isFetchingInstalledApps: true,
      })

      const { container } = render(<InstalledApp id="installed-app-123" />)
      const svg = container.querySelector('svg.spin-animation')
      expect(svg).toBeInTheDocument()
    })

    it('should render app not found (404) when installedApp does not exist', () => {
      ;(useContext as Mock).mockReturnValue({
        installedApps: [],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="nonexistent-app" />)
      expect(screen.getByText(/404/)).toBeInTheDocument()
    })
  })

  describe('Error States', () => {
    it('should render error when app params fails to load', () => {
      const error = new Error('Failed to load app params')
      ;(useGetInstalledAppParams as Mock).mockReturnValue({
        isFetching: false,
        data: null,
        error,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Failed to load app params/)).toBeInTheDocument()
    })

    it('should render error when app meta fails to load', () => {
      const error = new Error('Failed to load app meta')
      ;(useGetInstalledAppMeta as Mock).mockReturnValue({
        isFetching: false,
        data: null,
        error,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Failed to load app meta/)).toBeInTheDocument()
    })

    it('should render error when web app access mode fails to load', () => {
      const error = new Error('Failed to load access mode')
      ;(useGetInstalledAppAccessModeByAppId as Mock).mockReturnValue({
        isFetching: false,
        data: null,
        error,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Failed to load access mode/)).toBeInTheDocument()
    })

    it('should render error when user access check fails', () => {
      const error = new Error('Failed to check user access')
      ;(useGetUserCanAccessApp as Mock).mockReturnValue({
        data: null,
        error,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Failed to check user access/)).toBeInTheDocument()
    })

    it('should render no permission (403) when user cannot access app', () => {
      ;(useGetUserCanAccessApp as Mock).mockReturnValue({
        data: { result: false },
        error: null,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/403/)).toBeInTheDocument()
      expect(screen.getByText(/no permission/i)).toBeInTheDocument()
    })
  })

  describe('App Mode Rendering', () => {
    it('should render ChatWithHistory for CHAT mode', () => {
      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Chat With History/i)).toBeInTheDocument()
      expect(screen.queryByText(/Text Generation App/i)).not.toBeInTheDocument()
    })

    it('should render ChatWithHistory for ADVANCED_CHAT mode', () => {
      const advancedChatApp = {
        ...mockInstalledApp,
        app: {
          ...mockInstalledApp.app,
          mode: AppModeEnum.ADVANCED_CHAT,
        },
      }
      ;(useContext as Mock).mockReturnValue({
        installedApps: [advancedChatApp],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Chat With History/i)).toBeInTheDocument()
      expect(screen.queryByText(/Text Generation App/i)).not.toBeInTheDocument()
    })

    it('should render ChatWithHistory for AGENT_CHAT mode', () => {
      const agentChatApp = {
        ...mockInstalledApp,
        app: {
          ...mockInstalledApp.app,
          mode: AppModeEnum.AGENT_CHAT,
        },
      }
      ;(useContext as Mock).mockReturnValue({
        installedApps: [agentChatApp],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Chat With History/i)).toBeInTheDocument()
      expect(screen.queryByText(/Text Generation App/i)).not.toBeInTheDocument()
    })

    it('should render TextGenerationApp for COMPLETION mode', () => {
      const completionApp = {
        ...mockInstalledApp,
        app: {
          ...mockInstalledApp.app,
          mode: AppModeEnum.COMPLETION,
        },
      }
      ;(useContext as Mock).mockReturnValue({
        installedApps: [completionApp],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Text Generation App/i)).toBeInTheDocument()
      expect(screen.queryByText(/Workflow/)).not.toBeInTheDocument()
    })

    it('should render TextGenerationApp with workflow flag for WORKFLOW mode', () => {
      const workflowApp = {
        ...mockInstalledApp,
        app: {
          ...mockInstalledApp.app,
          mode: AppModeEnum.WORKFLOW,
        },
      }
      ;(useContext as Mock).mockReturnValue({
        installedApps: [workflowApp],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/Text Generation App/i)).toBeInTheDocument()
      expect(screen.getByText(/Workflow/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should use id prop to find installed app', () => {
      const app1 = { ...mockInstalledApp, id: 'app-1' }
      const app2 = { ...mockInstalledApp, id: 'app-2' }
      ;(useContext as Mock).mockReturnValue({
        installedApps: [app1, app2],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="app-2" />)
      expect(screen.getByText(/app-2/)).toBeInTheDocument()
    })

    it('should handle id that does not match any installed app', () => {
      render(<InstalledApp id="nonexistent-id" />)
      expect(screen.getByText(/404/)).toBeInTheDocument()
    })
  })

  describe('Effects', () => {
    it('should update app info when installedApp is available', async () => {
      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateAppInfo).toHaveBeenCalledWith(
          expect.objectContaining({
            app_id: 'installed-app-123',
            site: expect.objectContaining({
              title: 'Test App',
              icon_type: 'emoji',
              icon: '🚀',
              icon_background: '#FFFFFF',
              icon_url: '',
              prompt_public: false,
              copyright: '',
              show_workflow_steps: true,
              use_icon_as_answer_icon: false,
            }),
            plan: 'basic',
            custom_config: null,
          }),
        )
      })
    })

    it('should update app info to null when installedApp is not found', async () => {
      ;(useContext as Mock).mockReturnValue({
        installedApps: [],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="nonexistent-app" />)

      await waitFor(() => {
        expect(mockUpdateAppInfo).toHaveBeenCalledWith(null)
      })
    })

    it('should update app params when data is available', async () => {
      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateAppParams).toHaveBeenCalledWith(mockAppParams)
      })
    })

    it('should update app meta when data is available', async () => {
      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateWebAppMeta).toHaveBeenCalledWith(mockAppMeta)
      })
    })

    it('should update web app access mode when data is available', async () => {
      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateWebAppAccessMode).toHaveBeenCalledWith(AccessMode.PUBLIC)
      })
    })

    it('should update user can access app when data is available', async () => {
      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateUserCanAccessApp).toHaveBeenCalledWith(true)
      })
    })

    it('should update user can access app to false when result is false', async () => {
      ;(useGetUserCanAccessApp as Mock).mockReturnValue({
        data: { result: false },
        error: null,
      })

      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateUserCanAccessApp).toHaveBeenCalledWith(false)
      })
    })

    it('should update user can access app to false when data is null', async () => {
      ;(useGetUserCanAccessApp as Mock).mockReturnValue({
        data: null,
        error: null,
      })

      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateUserCanAccessApp).toHaveBeenCalledWith(false)
      })
    })

    it('should not update app params when data is null', async () => {
      ;(useGetInstalledAppParams as Mock).mockReturnValue({
        isFetching: false,
        data: null,
        error: null,
      })

      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateAppInfo).toHaveBeenCalled()
      })

      expect(mockUpdateAppParams).not.toHaveBeenCalled()
    })

    it('should not update app meta when data is null', async () => {
      ;(useGetInstalledAppMeta as Mock).mockReturnValue({
        isFetching: false,
        data: null,
        error: null,
      })

      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateAppInfo).toHaveBeenCalled()
      })

      expect(mockUpdateWebAppMeta).not.toHaveBeenCalled()
    })

    it('should not update access mode when data is null', async () => {
      ;(useGetInstalledAppAccessModeByAppId as Mock).mockReturnValue({
        isFetching: false,
        data: null,
        error: null,
      })

      render(<InstalledApp id="installed-app-123" />)

      await waitFor(() => {
        expect(mockUpdateAppInfo).toHaveBeenCalled()
      })

      expect(mockUpdateWebAppAccessMode).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty installedApps array', () => {
      ;(useContext as Mock).mockReturnValue({
        installedApps: [],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="installed-app-123" />)
      expect(screen.getByText(/404/)).toBeInTheDocument()
    })

    it('should handle multiple installed apps and find the correct one', () => {
      const otherApp = {
        ...mockInstalledApp,
        id: 'other-app-id',
        app: {
          ...mockInstalledApp.app,
          name: 'Other App',
        },
      }
      ;(useContext as Mock).mockReturnValue({
        installedApps: [otherApp, mockInstalledApp],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="installed-app-123" />)
      // Should find and render the correct app
      expect(screen.getByText(/Chat With History/i)).toBeInTheDocument()
      expect(screen.getByText(/installed-app-123/)).toBeInTheDocument()
    })

    it('should handle rapid id prop changes', async () => {
      const app1 = { ...mockInstalledApp, id: 'app-1' }
      const app2 = { ...mockInstalledApp, id: 'app-2' }
      ;(useContext as Mock).mockReturnValue({
        installedApps: [app1, app2],
        isFetchingInstalledApps: false,
      })

      const { rerender } = render(<InstalledApp id="app-1" />)
      expect(screen.getByText(/app-1/)).toBeInTheDocument()

      rerender(<InstalledApp id="app-2" />)
      expect(screen.getByText(/app-2/)).toBeInTheDocument()
    })

    it('should call service hooks with correct appId', () => {
      render(<InstalledApp id="installed-app-123" />)

      expect(useGetInstalledAppAccessModeByAppId).toHaveBeenCalledWith('installed-app-123')
      expect(useGetInstalledAppParams).toHaveBeenCalledWith('installed-app-123')
      expect(useGetInstalledAppMeta).toHaveBeenCalledWith('installed-app-123')
      expect(useGetUserCanAccessApp).toHaveBeenCalledWith({
        appId: 'app-123',
        isInstalledApp: true,
      })
    })

    it('should call service hooks with null when installedApp is not found', () => {
      ;(useContext as Mock).mockReturnValue({
        installedApps: [],
        isFetchingInstalledApps: false,
      })

      render(<InstalledApp id="nonexistent-app" />)

      expect(useGetInstalledAppAccessModeByAppId).toHaveBeenCalledWith(null)
      expect(useGetInstalledAppParams).toHaveBeenCalledWith(null)
      expect(useGetInstalledAppMeta).toHaveBeenCalledWith(null)
      expect(useGetUserCanAccessApp).toHaveBeenCalledWith({
        appId: undefined,
        isInstalledApp: true,
      })
    })
  })

  describe('Render Priority', () => {
    it('should show error before loading state', () => {
      ;(useGetInstalledAppParams as Mock).mockReturnValue({
        isFetching: true,
        data: null,
        error: new Error('Some error'),
      })

      render(<InstalledApp id="installed-app-123" />)
      // Error should take precedence over loading
      expect(screen.getByText(/Some error/)).toBeInTheDocument()
    })

    it('should show error before permission check', () => {
      ;(useGetInstalledAppParams as Mock).mockReturnValue({
        isFetching: false,
        data: null,
        error: new Error('Params error'),
      })
      ;(useGetUserCanAccessApp as Mock).mockReturnValue({
        data: { result: false },
        error: null,
      })

      render(<InstalledApp id="installed-app-123" />)
      // Error should take precedence over permission
      expect(screen.getByText(/Params error/)).toBeInTheDocument()
      expect(screen.queryByText(/403/)).not.toBeInTheDocument()
    })

    it('should show permission error before 404', () => {
      ;(useContext as Mock).mockReturnValue({
        installedApps: [],
        isFetchingInstalledApps: false,
      })
      ;(useGetUserCanAccessApp as Mock).mockReturnValue({
        data: { result: false },
        error: null,
      })

      render(<InstalledApp id="nonexistent-app" />)
      // Permission should take precedence over 404
      expect(screen.getByText(/403/)).toBeInTheDocument()
      expect(screen.queryByText(/404/)).not.toBeInTheDocument()
    })

    it('should show loading before 404', () => {
      ;(useContext as Mock).mockReturnValue({
        installedApps: [],
        isFetchingInstalledApps: false,
      })
      ;(useGetInstalledAppParams as Mock).mockReturnValue({
        isFetching: true,
        data: null,
        error: null,
      })

      const { container } = render(<InstalledApp id="nonexistent-app" />)
      // Loading should take precedence over 404
      const svg = container.querySelector('svg.spin-animation')
      expect(svg).toBeInTheDocument()
      expect(screen.queryByText(/404/)).not.toBeInTheDocument()
    })
  })
})
