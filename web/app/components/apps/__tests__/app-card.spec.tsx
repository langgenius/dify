import type { App } from '@/types/app'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import AppCard from '../app-card'

const {
  mockPush,
  mockGetRedirection,
  mockToastSuccess,
  mockToastError,
  mockUpdateAppInfo,
  mockCopyApp,
  mockExportAppBundle,
  mockExportAppConfig,
  mockUpgradeAppRuntime,
  mockFetchInstalledAppList,
  mockFetchWorkflowDraft,
  mockDeleteAppMutation,
  mockDownloadBlob,
  mockOpenAsyncWindow,
  mockOnPlanInfoChanged,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockGetRedirection: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockUpdateAppInfo: vi.fn(),
  mockCopyApp: vi.fn(),
  mockExportAppBundle: vi.fn(),
  mockExportAppConfig: vi.fn(),
  mockUpgradeAppRuntime: vi.fn(),
  mockFetchInstalledAppList: vi.fn(),
  mockFetchWorkflowDraft: vi.fn(),
  mockDeleteAppMutation: vi.fn(),
  mockDownloadBlob: vi.fn(),
  mockOpenAsyncWindow: vi.fn(),
  mockOnPlanInfoChanged: vi.fn(),
}))

let mockIsCurrentWorkspaceEditor = true
let mockWebappAuthEnabled = false
let mockUserCanAccessApp = true
let mockUserCanAccessAppLoading = false
let mockDeleteMutationPending = false

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: <T,>(selector: (state: {
    systemFeatures: {
      webapp_auth: { enabled: boolean }
      branding: { enabled: boolean }
    }
  }) => T) => selector({
    systemFeatures: {
      webapp_auth: { enabled: mockWebappAuthEnabled },
      branding: { enabled: false },
    },
  }),
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: () => ({
    data: { result: mockUserCanAccessApp },
    isLoading: mockUserCanAccessAppLoading,
  }),
}))

vi.mock('@/service/use-apps', () => ({
  useDeleteAppMutation: () => ({
    mutateAsync: mockDeleteAppMutation,
    isPending: mockDeleteMutationPending,
  }),
}))

vi.mock('@/service/apps', () => ({
  updateAppInfo: mockUpdateAppInfo,
  copyApp: mockCopyApp,
  exportAppBundle: mockExportAppBundle,
  exportAppConfig: mockExportAppConfig,
  upgradeAppRuntime: mockUpgradeAppRuntime,
}))

vi.mock('@/service/explore', () => ({
  fetchInstalledAppList: mockFetchInstalledAppList,
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: mockFetchWorkflowDraft,
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => mockOpenAsyncWindow,
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirection: mockGetRedirection,
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mockDownloadBlob,
}))

vi.mock('@/utils/time', () => ({
  formatTime: () => 'Jan 2, 2024',
}))

vi.mock('@/utils/var', () => ({
  basePath: '/console',
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@/app/components/app/type-selector', () => ({
  AppTypeIcon: () => React.createElement('div', { 'data-testid': 'app-type-icon' }),
}))

vi.mock('@/next/dynamic', () => ({
  default: (importFn: () => Promise<unknown>) => {
    const loader = importFn.toString()

    if (loader.includes('explore/create-app-modal')) {
      return function MockEditAppModal({
        show,
        onHide,
        onConfirm,
      }: {
        show: boolean
        onHide: () => void
        onConfirm?: (payload: {
          name: string
          icon_type: 'emoji'
          icon: string
          icon_background: string
          description: string
          use_icon_as_answer_icon: boolean
          max_active_requests: null
        }) => void
      }) {
        if (!show)
          return null

        return React.createElement(
          'div',
          { 'data-testid': 'edit-app-modal' },
          React.createElement('button', { 'data-testid': 'close-edit-modal', 'onClick': onHide }, 'Close'),
          React.createElement('button', {
            'data-testid': 'confirm-edit-modal',
            'onClick': () => onConfirm?.({
              name: 'Updated App',
              icon_type: 'emoji',
              icon: '🎯',
              icon_background: '#FFEAD5',
              description: 'Updated description',
              use_icon_as_answer_icon: false,
              max_active_requests: null,
            }),
          }, 'Confirm'),
        )
      }
    }

    if (loader.includes('app/duplicate-modal')) {
      return function MockDuplicateAppModal({
        show,
        onHide,
        onConfirm,
      }: {
        show: boolean
        onHide: () => void
        onConfirm?: (payload: {
          name: string
          icon_type: 'emoji'
          icon: string
          icon_background: string
        }) => void
      }) {
        if (!show)
          return null

        return React.createElement(
          'div',
          { 'data-testid': 'duplicate-app-modal' },
          React.createElement('button', { 'data-testid': 'close-duplicate-modal', 'onClick': onHide }, 'Close'),
          React.createElement('button', {
            'data-testid': 'confirm-duplicate-modal',
            'onClick': () => onConfirm?.({
              name: 'Copied App',
              icon_type: 'emoji',
              icon: '📋',
              icon_background: '#E4FBCC',
            }),
          }, 'Confirm'),
        )
      }
    }

    if (loader.includes('app/switch-app-modal')) {
      return function MockSwitchAppModal({
        show,
        onClose,
        onSuccess,
      }: {
        show: boolean
        onClose: () => void
        onSuccess: () => void
      }) {
        if (!show)
          return null

        return React.createElement(
          'div',
          { 'data-testid': 'switch-app-modal' },
          React.createElement('button', { 'data-testid': 'close-switch-modal', 'onClick': onClose }, 'Close'),
          React.createElement('button', { 'data-testid': 'confirm-switch-modal', 'onClick': onSuccess }, 'Confirm'),
        )
      }
    }

    if (loader.includes('workflow/dsl-export-confirm-modal')) {
      return function MockDslExportConfirmModal({
        onClose,
        onConfirm,
      }: {
        onClose?: () => void
        onConfirm?: (withSecrets: boolean) => void
      }) {
        return React.createElement(
          'div',
          { 'data-testid': 'dsl-export-confirm-modal' },
          React.createElement('button', { 'data-testid': 'close-dsl-export-modal', 'onClick': onClose }, 'Close'),
          React.createElement('button', { 'data-testid': 'confirm-dsl-export-modal', 'onClick': () => onConfirm?.(true) }, 'Confirm'),
        )
      }
    }

    if (loader.includes('app/app-access-control')) {
      return function MockAccessControl({
        onClose,
        onConfirm,
      }: {
        onClose: () => void
        onConfirm: () => void
      }) {
        return React.createElement(
          'div',
          { 'data-testid': 'access-control-modal' },
          React.createElement('button', { 'data-testid': 'close-access-control-modal', 'onClick': onClose }, 'Close'),
          React.createElement('button', { 'data-testid': 'confirm-access-control-modal', 'onClick': onConfirm }, 'Confirm'),
        )
      }
    }

    return () => null
  },
}))

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test app description',
  author_name: 'Test Author',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFEAD5',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: AppModeEnum.CHAT,
  runtime_type: 'classic',
  enable_site: true,
  enable_api: true,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as App['model_config'],
  app_model_config: {} as App['app_model_config'],
  created_at: 1704067200,
  updated_at: 1704153600,
  site: {} as App['site'],
  api_base_url: 'https://example.com',
  tags: [],
  access_mode: AccessMode.PUBLIC,
  has_draft_trigger: false,
  ...overrides,
}) as App

const renderAppCard = (appOverrides: Partial<App> = {}, onRefresh = vi.fn()) => {
  const app = createMockApp(appOverrides)
  render(<AppCard app={app} onRefresh={onRefresh} />)
  return { app, onRefresh }
}

const openOperationsMenu = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
  return await screen.findByRole('menu')
}

describe('AppCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceEditor = true
    mockWebappAuthEnabled = false
    mockUserCanAccessApp = true
    mockUserCanAccessAppLoading = false
    mockDeleteMutationPending = false

    mockUpdateAppInfo.mockResolvedValue(undefined)
    mockCopyApp.mockResolvedValue({ id: 'copied-app-id' })
    mockExportAppBundle.mockResolvedValue(undefined)
    mockExportAppConfig.mockResolvedValue({ data: 'yaml: content' })
    mockUpgradeAppRuntime.mockResolvedValue({ result: 'success', new_app_id: 'upgraded-app-id' })
    mockFetchInstalledAppList.mockResolvedValue({ installed_apps: [{ id: 'installed-1' }] })
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })
    mockDeleteAppMutation.mockResolvedValue(undefined)
    mockOpenAsyncWindow.mockImplementation(async (resolver: () => Promise<string>) => await resolver())
  })

  // Rendering and primary navigation behavior.
  describe('Rendering', () => {
    it('should render app metadata and type icon', () => {
      renderAppCard()

      expect(screen.getByTitle('Test App')).toBeInTheDocument()
      expect(screen.getByTitle('Test app description')).toBeInTheDocument()
      expect(screen.getByTitle('Test Author')).toBeInTheDocument()
      expect(screen.getByText(/datasetDocuments\.segment\.editedAt/i)).toBeInTheDocument()
      expect(screen.getByTestId('app-type-icon')).toBeInTheDocument()
    })

    it('should render the sandbox corner mark when the app uses sandboxed runtime', () => {
      renderAppCard({ runtime_type: 'sandboxed' })

      expect(screen.getByText('app.sandboxBadge')).toBeInTheDocument()
    })

    it('should not render the sandbox corner mark for classic runtime apps', () => {
      renderAppCard({ runtime_type: 'classic' })

      expect(screen.queryByText('app.sandboxBadge')).not.toBeInTheDocument()
    })

    it('should call getRedirection when the main card button is clicked', () => {
      const { app } = renderAppCard()

      fireEvent.click(screen.getByTitle('Test App').closest('button')!)

      expect(mockGetRedirection).toHaveBeenCalledWith(true, app, mockPush)
    })

    it('should open the operations menu without triggering card navigation', async () => {
      renderAppCard()

      const menu = await openOperationsMenu()

      expect(mockGetRedirection).not.toHaveBeenCalled()
      expect(within(menu).getByRole('menuitem', { name: 'app.editApp' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'app.duplicate' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'common.operation.delete' })).toBeInTheDocument()
    })

    it('should hide editor operations when the current user is not a workspace editor', () => {
      mockIsCurrentWorkspaceEditor = false
      renderAppCard()

      expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
    })

    it.each([
      [AppModeEnum.CHAT, true],
      [AppModeEnum.COMPLETION, true],
      [AppModeEnum.WORKFLOW, false],
    ])('should toggle the switch action for %s mode', async (mode, shouldExist) => {
      renderAppCard({ mode })

      const menu = await openOperationsMenu()
      const switchAction = within(menu).queryByRole('menuitem', { name: 'app.switch' })

      if (shouldExist)
        expect(switchAction).toBeInTheDocument()
      else
        expect(switchAction).not.toBeInTheDocument()
    })
  })

  // Editing and duplication should drive the expected service callbacks.
  describe('App mutations', () => {
    it('should submit updated app info when the edit modal is confirmed', async () => {
      const { onRefresh } = renderAppCard()

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.editApp' }))

      expect(await screen.findByTestId('edit-app-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('confirm-edit-modal'))

      await waitFor(() => {
        expect(mockUpdateAppInfo).toHaveBeenCalledWith({
          appID: 'test-app-id',
          name: 'Updated App',
          icon_type: 'emoji',
          icon: '🎯',
          icon_background: '#FFEAD5',
          description: 'Updated description',
          use_icon_as_answer_icon: false,
          max_active_requests: null,
        })
      })
      expect(mockToastSuccess).toHaveBeenCalledWith('app.editDone')
      expect(onRefresh).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(screen.queryByTestId('edit-app-modal')).not.toBeInTheDocument()
      })
    })

    it('should duplicate the app and redirect to the copied app', async () => {
      const { onRefresh } = renderAppCard()

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.duplicate' }))

      expect(await screen.findByTestId('duplicate-app-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('confirm-duplicate-modal'))

      await waitFor(() => {
        expect(mockCopyApp).toHaveBeenCalledWith({
          appID: 'test-app-id',
          name: 'Copied App',
          icon_type: 'emoji',
          icon: '📋',
          icon_background: '#E4FBCC',
          mode: AppModeEnum.CHAT,
        })
      })
      expect(localStorage.setItem).toHaveBeenCalledWith(NEED_REFRESH_APP_LIST_KEY, '1')
      expect(mockOnPlanInfoChanged).toHaveBeenCalledTimes(1)
      expect(onRefresh).toHaveBeenCalledTimes(1)
      expect(mockGetRedirection).toHaveBeenCalledWith(true, { id: 'copied-app-id' }, mockPush)
    })
  })

  // Export paths differ based on app mode and workflow secret variables.
  describe('Exporting', () => {
    it('should export and download the yaml config for a non-workflow app', async () => {
      renderAppCard({ mode: AppModeEnum.CHAT })

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.export' }))

      await waitFor(() => {
        expect(mockExportAppConfig).toHaveBeenCalledWith({
          appID: 'test-app-id',
          include: false,
        })
      })
      expect(mockDownloadBlob).toHaveBeenCalledTimes(1)
      expect(mockDownloadBlob.mock.calls[0][0]).toMatchObject({
        fileName: 'Test App.yml',
      })
    })

    it('should request secret confirmation before exporting workflow apps with secret envs', async () => {
      mockFetchWorkflowDraft.mockResolvedValueOnce({
        environment_variables: [{ name: 'SECRET_KEY', value_type: 'secret' }],
      })

      renderAppCard({ mode: AppModeEnum.WORKFLOW })

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.export' }))

      expect(await screen.findByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('confirm-dsl-export-modal'))

      await waitFor(() => {
        expect(mockExportAppConfig).toHaveBeenCalledWith({
          appID: 'test-app-id',
          include: true,
        })
      })
    })

    it('should close the secret export confirmation modal when dismissed', async () => {
      mockFetchWorkflowDraft.mockResolvedValueOnce({
        environment_variables: [{ name: 'SECRET_KEY', value_type: 'secret' }],
      })

      renderAppCard({ mode: AppModeEnum.WORKFLOW })

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.export' }))

      expect(await screen.findByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('close-dsl-export-modal'))

      await waitFor(() => {
        expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
      })
    })

    it('should export the app bundle for sandboxed apps', async () => {
      renderAppCard({ runtime_type: 'sandboxed' })

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.export' }))

      await waitFor(() => {
        expect(mockExportAppBundle).toHaveBeenCalledWith({
          appID: 'test-app-id',
          include: false,
        })
      })
      expect(mockExportAppConfig).not.toHaveBeenCalled()
    })
  })

  // Menu branches should stay aligned with auth and runtime conditions.
  describe('Conditional menu actions', () => {
    it('should open the installed app in Explore when web app auth is disabled', async () => {
      renderAppCard()

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.openInExplore' }))

      await waitFor(() => {
        expect(mockOpenAsyncWindow).toHaveBeenCalledTimes(1)
      })
      const [resolver] = mockOpenAsyncWindow.mock.calls[0]
      await expect(resolver()).resolves.toBe('/console/explore/installed/installed-1')
      expect(mockFetchInstalledAppList).toHaveBeenCalledWith('test-app-id')
    })

    it('should hide the Explore action when auth is enabled and the user cannot access the app', async () => {
      mockWebappAuthEnabled = true
      mockUserCanAccessApp = false
      renderAppCard()

      const menu = await openOperationsMenu()

      expect(within(menu).queryByRole('menuitem', { name: 'app.openInExplore' })).not.toBeInTheDocument()
    })

    it('should keep the Explore action when auth is enabled and the user can access the app', async () => {
      mockWebappAuthEnabled = true
      mockUserCanAccessApp = true
      renderAppCard()

      const menu = await openOperationsMenu()

      expect(within(menu).getByRole('menuitem', { name: 'app.openInExplore' })).toBeInTheDocument()
    })

    it('should open access control and refresh after confirmation when auth is enabled', async () => {
      mockWebappAuthEnabled = true
      const { onRefresh } = renderAppCard()

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.accessControl' }))

      expect(await screen.findByTestId('access-control-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('confirm-access-control-modal'))

      expect(onRefresh).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(screen.queryByTestId('access-control-modal')).not.toBeInTheDocument()
      })
    })

    it('should close access control without refreshing when dismissed', async () => {
      mockWebappAuthEnabled = true
      const { onRefresh } = renderAppCard()

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.accessControl' }))

      expect(await screen.findByTestId('access-control-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('close-access-control-modal'))

      await waitFor(() => {
        expect(screen.queryByTestId('access-control-modal')).not.toBeInTheDocument()
      })
      expect(onRefresh).not.toHaveBeenCalled()
    })

    it('should upgrade runtime and redirect to the new workflow app', async () => {
      mockWebappAuthEnabled = true
      renderAppCard({ mode: AppModeEnum.WORKFLOW, runtime_type: 'classic' })

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.upgradeRuntime' }))

      await waitFor(() => {
        expect(mockUpgradeAppRuntime).toHaveBeenCalledWith('test-app-id')
      })
      expect(mockToastSuccess).toHaveBeenCalledWith('workflow.sandboxMigrationModal.upgrade')
      expect(mockPush).toHaveBeenCalledWith('/app/upgraded-app-id/workflow?upgraded_from=test-app-id&upgraded_from_name=Test+App')
    })
  })

  // Delete flow should stay explicit and safe.
  describe('Deleting', () => {
    it('should enable confirmation only after the app name matches and then delete successfully', async () => {
      renderAppCard()

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'common.operation.delete' }))

      const dialog = await screen.findByRole('alertdialog')
      const textbox = within(dialog).getByRole('textbox')
      const confirmButton = within(dialog).getByRole('button', { name: 'common.operation.confirm' })

      expect(confirmButton).toBeDisabled()

      fireEvent.change(textbox, { target: { value: 'Wrong Name' } })
      expect(confirmButton).toBeDisabled()

      fireEvent.change(textbox, { target: { value: 'Test App' } })
      expect(confirmButton).toBeEnabled()

      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockDeleteAppMutation).toHaveBeenCalledWith('test-app-id')
      })
      expect(mockToastSuccess).toHaveBeenCalledWith('app.appDeleted')
      expect(mockOnPlanInfoChanged).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
    })

    it('should surface a toast error when deletion fails', async () => {
      mockDeleteAppMutation.mockRejectedValueOnce(new Error('Delete failed'))
      renderAppCard()

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'common.operation.delete' }))

      const dialog = await screen.findByRole('alertdialog')
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Test App' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('app.appDeleteFailed: Delete failed')
      })
    })
  })

  describe('Switching', () => {
    it('should close the switch modal without refreshing when dismissed', async () => {
      const { onRefresh } = renderAppCard({ mode: AppModeEnum.CHAT })

      const menu = await openOperationsMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'app.switch' }))

      expect(await screen.findByTestId('switch-app-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('close-switch-modal'))

      await waitFor(() => {
        expect(screen.queryByTestId('switch-app-modal')).not.toBeInTheDocument()
      })
      expect(onRefresh).not.toHaveBeenCalled()
    })
  })
})
