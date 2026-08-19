import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { AccessMode } from '@/models/access-control'
import * as exploreService from '@/service/explore'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import { AppCard } from '../app-card'
import { StarredAppCard } from '../starred-app-card'

let mockWebappAuthEnabled = false
let mockRbacEnabled = true
const mockUserCanAccessApp = vi.hoisted(() => ({
  result: true as boolean | undefined,
  isLoading: false,
}))
const mockAppDslExport = vi.hoisted(() => ({
  exportAppDsl: vi.fn(),
  isExporting: false,
}))
const mockWorkflowAppDslExport = vi.hoisted(() => ({
  exportWorkflowAppDsl: vi.fn(),
  isExporting: false,
}))
const mockCopyApp = vi.hoisted(() =>
  vi.fn((_variables: unknown): Promise<unknown> =>
    Promise.resolve({
      id: 'new-app-id',
      mode: 'chat',
      maintainer: 'user-1',
      permission_keys: [],
    }),
  ),
)
const mockUpdateAppMutation = vi.hoisted(() =>
  vi.fn((_variables: unknown): Promise<unknown> => Promise.resolve()),
)
const mockDeleteAppMutation = vi.hoisted(() =>
  vi.fn((_variables: unknown): Promise<unknown> => Promise.resolve()),
)
const mockStarAppMutation = vi.hoisted(() =>
  vi.fn((_variables: unknown): Promise<unknown> => Promise.resolve()),
)
const mockUnstarAppMutation = vi.hoisted(() =>
  vi.fn((_variables: unknown): Promise<unknown> => Promise.resolve()),
)

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const withMutation = (operation: object, mutationFn: typeof mockCopyApp) =>
    new Proxy(operation, {
      get(target, property, receiver) {
        if (property === 'mutationOptions')
          return () => ({ mutationFn: (variables: unknown) => mutationFn(variables) })
        return Reflect.get(target, property, receiver)
      },
    })
  const copy = new Proxy(actual.consoleQuery.apps.byAppId.copy, {
    get(target, property, receiver) {
      if (property === 'post') return withMutation(target.post, mockCopyApp)
      return Reflect.get(target, property, receiver)
    },
  })
  const star = new Proxy(actual.consoleQuery.apps.byAppId.star, {
    get(target, property, receiver) {
      if (property === 'post') return withMutation(target.post, mockStarAppMutation)
      if (property === 'delete') return withMutation(target.delete, mockUnstarAppMutation)
      return Reflect.get(target, property, receiver)
    },
  })
  const byAppId = new Proxy(actual.consoleQuery.apps.byAppId, {
    get(target, property, receiver) {
      if (property === 'copy') return copy
      if (property === 'put') return withMutation(target.put, mockUpdateAppMutation)
      if (property === 'delete') return withMutation(target.delete, mockDeleteAppMutation)
      if (property === 'star') return star
      return Reflect.get(target, property, receiver)
    },
  })
  const apps = new Proxy(actual.consoleQuery.apps, {
    get(target, property, receiver) {
      if (property === 'byAppId') return byAppId
      return Reflect.get(target, property, receiver)
    },
  })

  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, property, receiver) {
        if (property === 'apps') return apps
        return Reflect.get(target, property, receiver)
      },
    }),
  }
})

vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => mockAppDslExport,
  useExportWorkflowAppDsl: () => mockWorkflowAppDslExport,
}))

const getOperationsTrigger = () =>
  screen.getByRole('button', { name: /common\.operation\.moreActionsFor/ })

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

const toastMocks = vi.hoisted(() => {
  const record = vi.fn()
  const api = vi.fn((message: unknown, options?: Record<string, unknown>) =>
    record({ message, ...options }),
  )
  return {
    record,
    api: Object.assign(api, {
      success: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'success', message, ...options }),
      ),
      error: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'error', message, ...options }),
      ),
      warning: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'warning', message, ...options }),
      ),
      info: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'info', message, ...options }),
      ),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    }),
  }
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks.api,
}))

// Mock use-context-selector with stable toast reference for tracking calls
// Include createContext for components that use it (like Toast)
vi.mock('use-context-selector', () => ({
  createContext: <T,>(defaultValue: T) => React.createContext(defaultValue),
  useContext: () => ({
    notify: toastMocks.api,
  }),
  useContextSelector: (_context: unknown, selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      notify: toastMocks.api,
    }),
}))

const mockConsoleState = vi.hoisted(() => ({
  isCurrentWorkspaceEditor: true,
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: ['app.create_and_management'] as string[],
}))

const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, {
    accountProfile: mockConsoleState.userProfile,
    systemFeatures: {
      webapp_auth: { enabled: mockWebappAuthEnabled },
      branding: { enabled: false },
      rbac_enabled: mockRbacEnabled,
    },
  })

// Mock app context

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

// Mock provider context
const mockOnPlanInfoChanged = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
  }),
}))

// systemFeatures is seeded into the QueryClient via the local render helper.

vi.mock('@/service/apps', () => ({
  deleteApp: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/service/explore', () => ({
  fetchInstalledAppList: vi.fn(() => Promise.resolve({ installed_apps: [{ id: 'installed-1' }] })),
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: () => ({
    data:
      mockUserCanAccessApp.result === undefined
        ? undefined
        : { result: mockUserCanAccessApp.result },
    isLoading: mockUserCanAccessApp.isLoading,
  }),
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useGetUserCanAccessApp: () => ({
    data:
      mockUserCanAccessApp.result === undefined
        ? undefined
        : { result: mockUserCanAccessApp.result },
    isLoading: mockUserCanAccessApp.isLoading,
  }),
}))

// Mock hooks
const mockOpenAsyncWindow = vi.fn()
vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => mockOpenAsyncWindow,
}))

// Mock utils
const { mockGetRedirection } = vi.hoisted(() => ({
  mockGetRedirection: vi.fn(),
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirectionPath: (app: { id: string }) => `/app/${app.id}/configuration`,
  getRedirection: mockGetRedirection,
}))

vi.mock('@/utils/var', () => ({
  basePath: '',
}))

vi.mock('@/utils/time', () => ({
  formatTime: () => 'Jan 1, 2024',
}))

// Mock dynamic imports
vi.mock('@/next/dynamic', () => ({
  default: (importFn: () => Promise<unknown>) => {
    void importFn().catch(() => {})
    const fnString = importFn.toString()

    if (fnString.includes('create-app-modal') || fnString.includes('explore/create-app-modal')) {
      return function MockEditAppModal({
        show,
        onHide,
        onConfirm,
      }: {
        show: boolean
        onHide: () => void
        onConfirm?: (data: Record<string, unknown>) => void
      }) {
        if (!show) return null
        return React.createElement(
          'div',
          { 'data-testid': 'edit-app-modal' },
          React.createElement(
            'button',
            { onClick: onHide, 'data-testid': 'close-edit-modal' },
            'Close',
          ),
          React.createElement(
            'button',
            {
              onClick: () =>
                onConfirm?.({
                  name: 'Updated App',
                  icon_type: 'emoji',
                  icon: '🎯',
                  icon_background: '#FFEAD5',
                  description: 'Updated description',
                  use_icon_as_answer_icon: false,
                  max_active_requests: null,
                }),
              'data-testid': 'confirm-edit-modal',
            },
            'Confirm',
          ),
        )
      }
    }
    if (fnString.includes('duplicate-modal')) {
      return function MockDuplicateAppModal({
        show,
        onHide,
        onConfirm,
      }: {
        show: boolean
        onHide: () => void
        onConfirm?: (data: Record<string, unknown>) => void
      }) {
        if (!show) return null
        return React.createElement(
          'div',
          { 'data-testid': 'duplicate-modal' },
          React.createElement(
            'button',
            { onClick: onHide, 'data-testid': 'close-duplicate-modal' },
            'Close',
          ),
          React.createElement(
            'button',
            {
              onClick: () =>
                onConfirm?.({
                  name: 'Copied App',
                  icon_type: 'emoji',
                  icon: '📋',
                  icon_background: '#E4FBCC',
                }),
              'data-testid': 'confirm-duplicate-modal',
            },
            'Confirm',
          ),
        )
      }
    }
    if (fnString.includes('switch-app-modal')) {
      return function MockSwitchAppModal({
        show,
        onClose,
      }: {
        show: boolean
        onClose: () => void
      }) {
        if (!show) return null
        return React.createElement(
          'div',
          { 'data-testid': 'switch-modal' },
          React.createElement(
            'button',
            { onClick: onClose, 'data-testid': 'close-switch-modal' },
            'Close',
          ),
        )
      }
    }
    if (fnString.includes('dsl-export-confirm-modal')) {
      return function MockDSLExportModal({
        onClose,
        onConfirm,
      }: {
        onClose?: () => void
        onConfirm?: (withSecrets: boolean) => void
      }) {
        return React.createElement(
          'div',
          { 'data-testid': 'dsl-export-modal' },
          React.createElement(
            'button',
            { onClick: () => onClose?.(), 'data-testid': 'close-dsl-export' },
            'Close',
          ),
          React.createElement(
            'button',
            { onClick: () => onConfirm?.(true), 'data-testid': 'confirm-dsl-export' },
            'Export with secrets',
          ),
          React.createElement(
            'button',
            { onClick: () => onConfirm?.(false), 'data-testid': 'confirm-dsl-export-no-secrets' },
            'Export without secrets',
          ),
        )
      }
    }
    return () => null
  },
}))

// AppCardTags has tag API dependencies - mock for isolated testing
vi.mock('@/features/tag-management/components/app-card-tags', () => ({
  AppCardTags: ({
    tags,
    canBindOrUnbindTags,
  }: {
    tags?: { id: string; name: string }[]
    canBindOrUnbindTags?: boolean
  }) => {
    return React.createElement(
      'div',
      {
        'aria-label': 'tag-selector',
        'data-can-bind-or-unbind-tags': String(Boolean(canBindOrUnbindTags)),
      },
      tags?.map((tag: { id: string; name: string }) =>
        React.createElement('span', { key: tag.id }, tag.name),
      ),
    )
  },
}))

// AppTypeIcon has complex icon mapping - mock for focused component testing
vi.mock('@/app/components/app/type-selector', () => ({
  AppTypeIcon: () => React.createElement('div', { 'data-testid': 'app-type-icon' }),
}))

const createMockApp = (overrides: Partial<AppPartial> = {}): AppPartial => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test app description',
  mode: AppModeEnum.CHAT,
  icon: '🤖',
  icon_type: 'emoji' as const,
  icon_background: '#FFEAD5',
  icon_url: null,
  author_name: 'Test Author',
  created_by: 'user-1',
  maintainer: 'user-1',
  created_at: 1704067200,
  updated_at: 1704153600,
  tags: [],
  use_icon_as_answer_icon: false,
  max_active_requests: null,
  access_mode: AccessMode.PUBLIC,
  has_draft_trigger: false,
  permission_keys: [],
  ...overrides,
})

describe('AppCard', () => {
  const mockApp = createMockApp()

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenAsyncWindow.mockReset()
    mockWebappAuthEnabled = false
    mockRbacEnabled = true
    mockUserCanAccessApp.result = true
    mockUserCanAccessApp.isLoading = false
    mockCopyApp.mockResolvedValue({
      id: 'new-app-id',
      mode: 'chat',
      maintainer: 'user-1',
      permission_keys: [],
    })
    mockAppDslExport.isExporting = false
    mockAppDslExport.exportAppDsl.mockResolvedValue({ status: 'downloaded' })
    mockWorkflowAppDslExport.isExporting = false
    mockWorkflowAppDslExport.exportWorkflowAppDsl.mockResolvedValue({ status: 'downloaded' })
    mockConsoleState.isCurrentWorkspaceEditor = true
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = ['app.create_and_management']
  })

  describe('Rendering', () => {
    it('should render preview-only app card as a dimmed information-only card', () => {
      const previewOnlyApp = createMockApp({
        name: 'Preview Only App',
        description: 'Only visible metadata',
        author_name: 'Readonly Author',
        created_by: 'another-user',
        maintainer: 'another-user',
        tags: [{ id: 'tag-preview', name: 'Readonly Tag', type: 'app' as const }],
        permission_keys: [AppACLPermission.Preview],
      })

      render(<AppCard app={previewOnlyApp} />)

      const card = screen.getByRole('button', { name: 'Preview Only App' })
      expect(card).toHaveClass('opacity-60')
      expect(card).not.toHaveAttribute('aria-disabled')
      expect(screen.getByText('Only visible metadata')).toBeInTheDocument()
      expect(screen.getByText('Readonly Author')).toBeInTheDocument()
      const tagSelector = screen.getByLabelText('tag-selector')
      expect(tagSelector).toBeInTheDocument()
      expect(tagSelector).toHaveAttribute('data-can-bind-or-unbind-tags', 'false')
      expect(screen.queryByRole('link', { name: 'Preview Only App' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'app.studio.starApp' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: /common\.operation\.moreActionsFor/,
        }),
      ).not.toBeInTheDocument()

      fireEvent.click(tagSelector)

      expect(toastMocks.record).not.toHaveBeenCalled()

      fireEvent.click(card)

      expect(toastMocks.record).toHaveBeenCalledWith({
        type: 'warning',
        message: 'app.noAccessResourcePermission',
      })
    })

    it('should render preview-only starred app card as a dimmed information-only card', () => {
      const previewOnlyApp = createMockApp({
        name: 'Preview Only Starred App',
        author_name: 'Readonly Author',
        created_by: 'another-user',
        maintainer: 'another-user',
        permission_keys: [AppACLPermission.Preview],
      })

      render(<StarredAppCard app={previewOnlyApp} />)

      const card = screen.getByRole('button', { name: 'Preview Only Starred App' })
      expect(card).toHaveClass('opacity-60')
      expect(card).not.toHaveAttribute('aria-disabled')
      expect(screen.getByText('Readonly Author')).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'Preview Only Starred App' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'app.studio.starApp' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: /common\.operation\.moreActionsFor/,
        }),
      ).not.toBeInTheDocument()

      fireEvent.click(card)

      expect(toastMocks.record).toHaveBeenCalledWith({
        type: 'warning',
        message: 'app.noAccessResourcePermission',
      })
    })

    it('should display app name', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should display app description', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByText('Test app description')).toBeInTheDocument()
    })

    it('should display author name', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByText('Test Author')).toBeInTheDocument()
    })

    it('should render app icon', () => {
      // AppIcon component renders the emoji icon from app data
      const { container } = render(<AppCard app={mockApp} />)
      const emojiIcon = container.querySelector(`em-emoji[id="${mockApp.icon}"]`)
      const imageIcon = container.querySelector('img')
      expect(emojiIcon || imageIcon).toBeTruthy()
    })

    it('should render app type icon', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByTestId('app-type-icon')).toBeInTheDocument()
    })

    it('should display formatted edit time', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByText(/edited/i)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should handle different app modes', () => {
      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)
      expect(screen.getByRole('link', { name: 'Test App' })).toBeInTheDocument()
    })

    it('should handle app with tags', () => {
      const appWithTags = {
        ...mockApp,
        tags: [{ id: 'tag1', name: 'Tag 1', type: 'app' as const, binding_count: '' }],
      }
      render(<AppCard app={appWithTags} />)
      // Verify the tag selector component renders
      expect(screen.getByLabelText('tag-selector')).toBeInTheDocument()
    })

    it('should display refreshed tag names from app props when tag ids stay the same', () => {
      const firstApp = createMockApp({
        tags: [{ id: 'tag1', name: 'Old Tag', type: 'app' as const }],
      })
      const refreshedApp = createMockApp({
        tags: [{ id: 'tag1', name: 'New Tag', type: 'app' as const }],
      })

      const { rerender } = render(<AppCard app={firstApp} />)
      expect(screen.getByText('Old Tag')).toBeInTheDocument()

      rerender(<AppCard app={refreshedApp} />)

      expect(screen.getByText('New Tag')).toBeInTheDocument()
      expect(screen.queryByText('Old Tag')).not.toBeInTheDocument()
    })

    it('should allow app edit permission to bind tags without workspace tag management permission', () => {
      mockConsoleState.isCurrentWorkspaceEditor = false
      mockConsoleState.workspacePermissionKeys = []
      mockConsoleState.userProfile = { id: 'user-2' }
      const editableApp = createMockApp({
        maintainer: 'user-1',
        tags: [{ id: 'tag1', name: 'Tag 1', type: 'app' as const }],
        permission_keys: [AppACLPermission.Edit],
      })

      render(<AppCard app={editableApp} />)

      expect(screen.getByLabelText('tag-selector')).toHaveAttribute(
        'data-can-bind-or-unbind-tags',
        'true',
      )
    })

    it('should allow workspace app tag management permission to bind tags without app edit permission', () => {
      mockConsoleState.isCurrentWorkspaceEditor = false
      mockConsoleState.workspacePermissionKeys = ['app.tag.manage']
      mockConsoleState.userProfile = { id: 'user-2' }
      const tagManageApp = createMockApp({
        maintainer: 'user-1',
        tags: [{ id: 'tag1', name: 'Tag 1', type: 'app' as const }],
        permission_keys: [AppACLPermission.ViewLayout],
      })

      render(<AppCard app={tagManageApp} />)

      expect(screen.getByLabelText('tag-selector')).toHaveAttribute(
        'data-can-bind-or-unbind-tags',
        'true',
      )
    })

    it('should render existing app tags as readonly without app edit or workspace tag management permission', () => {
      mockConsoleState.isCurrentWorkspaceEditor = false
      mockConsoleState.workspacePermissionKeys = []
      mockConsoleState.userProfile = { id: 'user-2' }
      const readonlyApp = createMockApp({
        maintainer: 'user-1',
        tags: [{ id: 'tag1', name: 'Tag 1', type: 'app' as const }],
        permission_keys: [AppACLPermission.ViewLayout],
      })

      render(<AppCard app={readonlyApp} />)

      expect(screen.getByLabelText('tag-selector')).toHaveAttribute(
        'data-can-bind-or-unbind-tags',
        'false',
      )
    })
  })

  describe('Web app access control entry points', () => {
    it('should not render the access mode icon or tooltip trigger', () => {
      render(<AppCard app={mockApp} />)

      expect(
        screen.queryByRole('img', { name: 'app.accessItemsDescription.anyone' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Card Interaction', () => {
    it('should render card navigation as a link', () => {
      render(<AppCard app={mockApp} />)
      const cardLink = screen.getByRole('link', { name: 'Test App' })

      expect(cardLink).toHaveAttribute('href', '/app/test-app-id/configuration')
    })

    it('should expose a visible focus ring on the card link', () => {
      render(<AppCard app={mockApp} />)
      const cardLink = screen.getByRole('link', { name: 'Test App' })

      expect(cardLink).toHaveClass('focus-visible:ring-2')
      expect(cardLink).toHaveClass('focus-visible:ring-state-accent-solid')
    })

    it('should star the app from the card action without navigating', async () => {
      const user = userEvent.setup()
      render(<AppCard app={mockApp} />)

      const starToggle = screen.getByRole('button', { name: 'app.studio.starApp' })
      expect(starToggle).toHaveAttribute('aria-pressed', 'false')

      await user.click(starToggle)

      await waitFor(() => {
        expect(mockStarAppMutation).toHaveBeenCalledWith({
          params: { app_id: mockApp.id },
        })
      })
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should unstar the app from the filled star action', async () => {
      const user = userEvent.setup()
      const starredApp = createMockApp({ is_starred: true })
      render(<AppCard app={starredApp} />)

      const starToggle = screen.getByRole('button', { name: 'app.studio.starApp' })
      expect(starToggle).toHaveAttribute('aria-pressed', 'true')

      await user.click(starToggle)

      await waitFor(() => {
        expect(mockUnstarAppMutation).toHaveBeenCalledWith({
          params: { app_id: starredApp.id },
        })
      })
    })
  })

  describe('Operations Menu', () => {
    it('should reveal operations trigger when card receives keyboard focus', () => {
      render(<AppCard app={mockApp} />)
      const operationsTrigger = getOperationsTrigger()
      const operationsTriggerWrapper = operationsTrigger.closest('.absolute')

      expect(operationsTriggerWrapper).toHaveClass('top-2')
      expect(operationsTriggerWrapper).toHaveClass('right-2')
      expect(operationsTriggerWrapper).toHaveClass('group-focus-within:pointer-events-auto')
      expect(operationsTriggerWrapper).toHaveClass('group-focus-within:opacity-100')
      expect(operationsTriggerWrapper).not.toHaveClass('w-[120px]')
      expect(operationsTrigger).toHaveClass('focus-visible:ring-2')
      expect(operationsTrigger).toHaveClass('focus-visible:ring-state-accent-solid')
    })

    it('should show edit option when dropdown menu is opened', async () => {
      const user = userEvent.setup()
      render(<AppCard app={mockApp} />)

      await user.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('app.editApp')).toBeInTheDocument()
      })
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should show duplicate option when dropdown menu is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('app.duplicate')).toBeInTheDocument()
      })
    })

    it('should show duplicate option when user can create apps without app import export permission', async () => {
      const appWithoutImportExportPermission = createMockApp({
        created_by: 'another-user',
        maintainer: 'another-user',
        permission_keys: [AppACLPermission.ViewLayout],
      })
      render(<AppCard app={appWithoutImportExportPermission} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('app.duplicate')).toBeInTheDocument()
      })
      expect(screen.queryByText('app.export')).not.toBeInTheDocument()
    })

    it('should show duplicate option on starred cards when user can create apps without app import export permission', async () => {
      const appWithoutImportExportPermission = createMockApp({
        created_by: 'another-user',
        maintainer: 'another-user',
        permission_keys: [AppACLPermission.ViewLayout],
      })
      render(<StarredAppCard app={appWithoutImportExportPermission} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('app.duplicate')).toBeInTheDocument()
      })
      expect(screen.queryByText('app.export')).not.toBeInTheDocument()
    })

    it('should show export option when dropdown menu is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('app.export')).toBeInTheDocument()
      })
    })

    it('should show delete option when dropdown menu is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      })
    })

    it('should show switch option for chat mode apps', async () => {
      const chatApp = { ...mockApp, mode: AppModeEnum.CHAT }
      render(<AppCard app={chatApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText(/switch/i)).toBeInTheDocument()
      })
    })

    it('should hide duplicate but keep app-authorized switch without app creation permission', async () => {
      mockConsoleState.workspacePermissionKeys = []
      const editableChatApp = createMockApp({
        created_by: 'another-user',
        maintainer: 'another-user',
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.Edit],
      })
      render(<AppCard app={editableChatApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText(/switch/i)).toBeInTheDocument()
      })
      expect(screen.queryByText('app.duplicate')).not.toBeInTheDocument()
    })

    it('should show switch option for completion mode apps', async () => {
      const completionApp = { ...mockApp, mode: AppModeEnum.COMPLETION }
      render(<AppCard app={completionApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText(/switch/i)).toBeInTheDocument()
      })
    })

    it('should not show switch option for workflow mode apps', async () => {
      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.queryByText(/switch/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('Modal Interactions', () => {
    it('should open edit modal when edit button is clicked', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        const editButton = screen.getByText('app.editApp')
        fireEvent.click(editButton)
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })
    })

    it('should open duplicate modal when duplicate button is clicked', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        const duplicateButton = screen.getByText('app.duplicate')
        fireEvent.click(duplicateButton)
      })

      await waitFor(() => {
        expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument()
      })
    })

    it('should open confirm dialog when delete button is clicked', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    })

    it('should autofill the app name for delete confirmation', async () => {
      const user = userEvent.setup()
      render(<AppCard app={mockApp} />)

      await user.click(getOperationsTrigger())
      await user.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))

      const deleteInput = await screen.findByRole('textbox')
      const confirmButton = screen.getByRole('button', { name: 'common.operation.confirm' })

      expect(confirmButton).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'common.operation.fill' }))

      expect(deleteInput).toHaveValue(mockApp.name)
      expect(confirmButton).toBeEnabled()
    })

    it('should close confirm dialog when cancel is clicked', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
    })

    it('should not submit delete when confirmation text does not match', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))

      const form = (await screen.findByRole('alertdialog')).querySelector('form')
      expect(form).toBeTruthy()
      fireEvent.submit(form!)

      expect(mockDeleteAppMutation).not.toHaveBeenCalled()
    })

    it('should close edit modal when onHide is called', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.editApp'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })

      // Click close button to trigger onHide
      fireEvent.click(screen.getByTestId('close-edit-modal'))

      await waitFor(() => {
        expect(screen.queryByTestId('edit-app-modal')).not.toBeInTheDocument()
      })
    })

    it('should close duplicate modal when onHide is called', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.duplicate'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument()
      })

      // Click close button to trigger onHide
      fireEvent.click(screen.getByTestId('close-duplicate-modal'))

      await waitFor(() => {
        expect(screen.queryByTestId('duplicate-modal')).not.toBeInTheDocument()
      })
    })

    it('should clear delete confirmation input after closing the dialog', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))

      const deleteInput = await screen.findByRole('textbox')
      fireEvent.change(deleteInput, { target: { value: 'partial name' } })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })

      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toHaveValue('')
      })
    })
  })

  describe('API Callbacks', () => {
    it('should call deleteApp API when confirming delete', async () => {
      render(<AppCard app={mockApp} />)

      // Open dropdown menu and click delete
      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

      // Fill in the confirmation input with app name
      const deleteInput = screen.getByRole('textbox')
      fireEvent.change(deleteInput, { target: { value: mockApp.name } })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mockDeleteAppMutation).toHaveBeenCalled()
      })
    })

    it('should handle delete failure', async () => {
      mockDeleteAppMutation.mockRejectedValueOnce(new Error('Delete failed'))

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

      // Fill in the confirmation input with app name
      const deleteInput = screen.getByRole('textbox')
      fireEvent.change(deleteInput, { target: { value: mockApp.name } })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mockDeleteAppMutation).toHaveBeenCalled()
        expect(toastMocks.record).toHaveBeenCalledWith({
          type: 'error',
          message: expect.stringContaining('Delete failed'),
        })
      })
    })

    it('should handle delete failure without an error message', async () => {
      mockDeleteAppMutation.mockRejectedValueOnce({})

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

      fireEvent.change(screen.getByRole('textbox'), { target: { value: mockApp.name } })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mockDeleteAppMutation).toHaveBeenCalled()
        expect(toastMocks.record).toHaveBeenCalledWith({
          type: 'error',
          message: 'app.appDeleteFailed',
        })
      })
    })

    it('should update the app and close the edit modal', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.editApp'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-edit-modal'))

      await waitFor(() => {
        expect(mockUpdateAppMutation).toHaveBeenCalledWith({
          params: { app_id: mockApp.id },
          body: {
            name: 'Updated App',
            icon_type: 'emoji',
            icon: '🎯',
            icon_background: '#FFEAD5',
            description: 'Updated description',
            use_icon_as_answer_icon: false,
            max_active_requests: null,
          },
        })
        expect(screen.queryByTestId('edit-app-modal')).not.toBeInTheDocument()
      })
    })

    it('should call copyApp API when duplicating app', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.duplicate'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-duplicate-modal'))

      await waitFor(() => {
        expect(mockCopyApp).toHaveBeenCalled()
      })
    })

    it('should call onPlanInfoChanged after successful duplication', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.duplicate'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-duplicate-modal'))

      await waitFor(() => {
        expect(mockOnPlanInfoChanged).toHaveBeenCalled()
      })
    })

    it('should handle copy failure', async () => {
      mockCopyApp.mockRejectedValueOnce(new Error('Copy failed'))

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.duplicate'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-duplicate-modal'))

      await waitFor(() => {
        expect(mockCopyApp).toHaveBeenCalled()
        expect(toastMocks.record).toHaveBeenCalledWith({
          type: 'error',
          message: 'app.newApp.appCreateFailed',
        })
      })
    })

    it('should export the app DSL when exporting', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      expect(mockAppDslExport.exportAppDsl).toHaveBeenCalledWith({
        appId: mockApp.id,
        appName: mockApp.name,
      })
    })

    it('should prevent duplicate exports while an app DSL export is pending', () => {
      mockAppDslExport.isExporting = true
      render(<AppCard app={mockApp} />)

      const trigger = screen.getByRole('button', { name: 'common.operation.exporting' })
      expect(trigger).toBeDisabled()
    })
  })

  describe('Switch Modal', () => {
    it('should open switch modal when switch button is clicked', async () => {
      const chatApp = { ...mockApp, mode: AppModeEnum.CHAT }
      render(<AppCard app={chatApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.switch'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('switch-modal')).toBeInTheDocument()
      })
    })

    it('should close switch modal when close button is clicked', async () => {
      const chatApp = { ...mockApp, mode: AppModeEnum.CHAT }
      render(<AppCard app={chatApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.switch'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('switch-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('close-switch-modal'))

      await waitFor(() => {
        expect(screen.queryByTestId('switch-modal')).not.toBeInTheDocument()
      })
    })

    it('should open switch modal for completion mode apps', async () => {
      const completionApp = { ...mockApp, mode: AppModeEnum.COMPLETION }
      render(<AppCard app={completionApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.switch'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('switch-modal')).toBeInTheDocument()
      })
    })
  })

  describe('Open in Explore', () => {
    it('should show open in explore option when dropdown menu is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('app.openInExplore')).toBeInTheDocument()
      })
    })
  })

  describe('Workflow Export with Environment Variables', () => {
    it('should use the workflow export command for workflow apps', async () => {
      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(mockWorkflowAppDslExport.exportWorkflowAppDsl).toHaveBeenCalledWith({
          appId: workflowApp.id,
          appName: workflowApp.name,
        })
      })
      expect(mockAppDslExport.exportAppDsl).not.toHaveBeenCalled()
    })

    it('should show DSL export modal when workflow has secret variables', async () => {
      mockWorkflowAppDslExport.exportWorkflowAppDsl.mockResolvedValueOnce({
        status: 'confirmation-required',
        secretEnvList: [{ value_type: 'secret', name: 'API_KEY', value: 'secret' }],
      })

      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('dsl-export-modal')).toBeInTheDocument()
      })
    })

    it('should not open a modal when the workflow command downloads directly', async () => {
      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(mockWorkflowAppDslExport.exportWorkflowAppDsl).toHaveBeenCalledWith({
          appId: workflowApp.id,
          appName: workflowApp.name,
        })
      })

      expect(screen.queryByTestId('dsl-export-modal')).not.toBeInTheDocument()
    })

    it('should use the workflow export command for advanced chat apps', async () => {
      const advancedChatApp = { ...mockApp, mode: AppModeEnum.ADVANCED_CHAT }
      render(<AppCard app={advancedChatApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(mockWorkflowAppDslExport.exportWorkflowAppDsl).toHaveBeenCalledWith({
          appId: advancedChatApp.id,
          appName: advancedChatApp.name,
        })
      })
    })

    it('should close DSL export modal when onClose is called', async () => {
      mockWorkflowAppDslExport.exportWorkflowAppDsl.mockResolvedValueOnce({
        status: 'confirmation-required',
        secretEnvList: [{ value_type: 'secret', name: 'API_KEY', value: 'secret' }],
      })

      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('dsl-export-modal')).toBeInTheDocument()
      })

      // Click close button to trigger onClose
      fireEvent.click(screen.getByTestId('close-dsl-export'))

      await waitFor(() => {
        expect(screen.queryByTestId('dsl-export-modal')).not.toBeInTheDocument()
      })
    })
  })

  describe('Edit mutation', () => {
    it('should handle edit failure', async () => {
      mockUpdateAppMutation.mockRejectedValueOnce(new Error('Edit failed'))

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.editApp'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-edit-modal'))

      await waitFor(() => {
        expect(mockUpdateAppMutation).toHaveBeenCalled()
        expect(toastMocks.record).toHaveBeenCalledWith({
          type: 'error',
          message: expect.stringContaining('Edit failed'),
        })
      })
    })

    it('should fall back to the default edit failure message', async () => {
      mockUpdateAppMutation.mockRejectedValueOnce({ message: '' })

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.editApp'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-edit-modal'))

      await waitFor(() => {
        expect(mockUpdateAppMutation).toHaveBeenCalled()
        expect(toastMocks.record).toHaveBeenCalledWith({ type: 'error', message: 'app.editFailed' })
      })
    })
  })

  describe('Operations behavior', () => {
    it('should close operations menu after selecting an item', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      fireEvent.click(await screen.findByRole('menuitem', { name: 'app.editApp' }))

      await waitFor(() => {
        expect(getOperationsTrigger()).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })
    })

    it('should handle open in explore via async window', async () => {
      let openedUrl = ''
      // Configure mockOpenAsyncWindow to actually call the callback
      mockOpenAsyncWindow.mockImplementationOnce(async (callback: () => Promise<string>) => {
        openedUrl = await callback()
      })

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        const openInExploreBtn = screen.getByText('app.openInExplore')
        fireEvent.click(openInExploreBtn)
      })

      await waitFor(() => {
        expect(exploreService.fetchInstalledAppList).toHaveBeenCalledWith(mockApp.id)
        expect(openedUrl).toBe('/installed/installed-1')
      })
    })

    it('should show string errors from open in explore onError callback', async () => {
      mockOpenAsyncWindow.mockImplementationOnce(
        async (
          _callback: () => Promise<string>,
          options?: { onError?: (err: unknown) => void },
        ) => {
          options?.onError?.('Window failed')
        },
      )

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.openInExplore'))
      })

      await waitFor(() => {
        expect(toastMocks.record).toHaveBeenCalledWith({ type: 'error', message: 'Window failed' })
      })
    })
  })

  describe('Access Control', () => {
    it('should render the tour-controlled operations menu as presentation only', async () => {
      render(
        <AppCard
          app={mockApp}
          stepByStepTourActionMenuHighlightPart={
            STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu
          }
          stepByStepTourActionMenuOpen
        />,
      )

      expect(await screen.findByText('app.editApp')).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'app.editApp', hidden: true }),
      ).toBeInTheDocument()
      expect(
        document.querySelector(
          `[data-step-by-step-tour-highlight-part="${STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu}"]`,
        ),
      ).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu,
      )
      expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByRole('menu', { hidden: true })).toHaveClass('pointer-events-none')
    })
  })

  describe('Open in Explore - No App Found', () => {
    it('should tell workflow users to publish before opening in explore', async () => {
      const workflowApp = createMockApp({
        mode: AppModeEnum.WORKFLOW,
        workflow: undefined,
      })
      render(<AppCard app={workflowApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        expect(screen.getByText('app.openInExplore')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('app.openInExplore'))

      expect(mockOpenAsyncWindow).not.toHaveBeenCalled()
      expect(exploreService.fetchInstalledAppList).not.toHaveBeenCalled()
      expect(toastMocks.record).toHaveBeenCalledWith({
        type: 'error',
        message: 'app.notPublishedYet',
      })
    })

    it('should handle case when installed_apps is empty array', async () => {
      vi.mocked(exploreService.fetchInstalledAppList).mockResolvedValueOnce({
        has_more: false,
        installed_apps: [],
        next_cursor: null,
      })

      // Configure mockOpenAsyncWindow to call the callback and trigger error
      mockOpenAsyncWindow.mockImplementationOnce(
        async (callback: () => Promise<string>, options?: { onError?: (err: unknown) => void }) => {
          try {
            await callback()
          } catch (err) {
            options?.onError?.(err)
          }
        },
      )

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        const openInExploreBtn = screen.getByText('app.openInExplore')
        fireEvent.click(openInExploreBtn)
      })

      await waitFor(() => {
        expect(exploreService.fetchInstalledAppList).toHaveBeenCalled()
        expect(toastMocks.record).toHaveBeenCalledWith({
          type: 'error',
          message: 'app.notPublishedYet',
        })
      })
    })

    it('should handle case when API throws in callback', async () => {
      vi.mocked(exploreService.fetchInstalledAppList).mockRejectedValueOnce(
        new Error('Network error'),
      )

      // Configure mockOpenAsyncWindow to call the callback without catching
      mockOpenAsyncWindow.mockImplementationOnce(async (callback: () => Promise<string>) => {
        return await callback()
      })

      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        const openInExploreBtn = screen.getByText('app.openInExplore')
        fireEvent.click(openInExploreBtn)
      })

      await waitFor(() => {
        expect(exploreService.fetchInstalledAppList).toHaveBeenCalled()
      })
    })
  })

  describe('Draft Trigger Apps', () => {
    it('should not show open in explore option for apps with has_draft_trigger', async () => {
      const draftTriggerApp = createMockApp({ has_draft_trigger: true })
      render(<AppCard app={draftTriggerApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        expect(screen.getByText('app.editApp')).toBeInTheDocument()
        // openInExplore should not be shown for draft trigger apps
        expect(screen.queryByText('app.openInExplore')).not.toBeInTheDocument()
      })
    })
  })

  describe('Non-editor User', () => {
    it('should handle non-editor workspace users', () => {
      // This tests the isCurrentWorkspaceEditor=true branch (default mock)
      render(<AppCard app={mockApp} />)
      expect(screen.getByRole('link', { name: 'Test App' })).toBeInTheDocument()
    })
  })

  describe('WebApp Auth Enabled', () => {
    beforeEach(() => {
      mockWebappAuthEnabled = true
    })

    it('should omit web app access control when webapp_auth is enabled', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        expect(screen.getByText('app.editApp')).toBeInTheDocument()
      })
      expect(screen.queryByText('app.accessControl')).not.toBeInTheDocument()
    })

    it('should omit web app access control for release-and-version permission', async () => {
      const appWithReleasePermission = createMockApp({
        created_by: 'another-user',
        maintainer: 'another-user',
        permission_keys: [AppACLPermission.ReleaseAndVersion, AppACLPermission.Delete],
      })
      render(<AppCard app={appWithReleasePermission} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      })
      expect(screen.queryByText('app.accessControl')).not.toBeInTheDocument()
    })

    it('should show resource access option when user only has app access config permission', async () => {
      const appWithAccessConfigPermission = createMockApp({
        created_by: 'another-user',
        maintainer: 'another-user',
        permission_keys: [AppACLPermission.AccessConfig, AppACLPermission.Delete],
      })
      render(<AppCard app={appWithAccessConfigPermission} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      })
      expect(screen.queryByText('app.accessControl')).not.toBeInTheDocument()
      expect(screen.getByText('common.settings.resourceAccess')).toBeInTheDocument()
    })

    it('should hide resource access option when RBAC is disabled', async () => {
      mockRbacEnabled = false
      const appWithAccessConfigPermission = createMockApp({
        created_by: 'another-user',
        maintainer: 'another-user',
        permission_keys: [AppACLPermission.AccessConfig, AppACLPermission.Delete],
      })
      render(<AppCard app={appWithAccessConfigPermission} />)

      fireEvent.click(getOperationsTrigger())

      await waitFor(() => {
        expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      })
      expect(screen.queryByText('common.settings.resourceAccess')).not.toBeInTheDocument()
    })

    it('should navigate to app access config when resource access is clicked', async () => {
      const appWithAccessConfigPermission = createMockApp({
        created_by: 'another-user',
        maintainer: 'another-user',
        permission_keys: [AppACLPermission.AccessConfig],
      })
      render(<AppCard app={appWithAccessConfigPermission} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        fireEvent.click(screen.getByText('common.settings.resourceAccess'))
      })

      expect(mockPush).toHaveBeenCalledWith('/app/test-app-id/access-config')
    })

    it('should show open in explore when userCanAccessApp is true', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        expect(screen.getByText('app.openInExplore')).toBeInTheDocument()
      })
    })

    it('should keep open in explore visible for unpublished workflow apps while access check is pending', async () => {
      mockUserCanAccessApp.result = false
      mockUserCanAccessApp.isLoading = true
      const workflowApp = createMockApp({
        mode: AppModeEnum.WORKFLOW,
        workflow: undefined,
      })

      render(<AppCard app={workflowApp} />)

      fireEvent.click(getOperationsTrigger())
      await waitFor(() => {
        expect(screen.getByText('app.openInExplore')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('app.openInExplore'))

      expect(mockOpenAsyncWindow).not.toHaveBeenCalled()
      expect(exploreService.fetchInstalledAppList).not.toHaveBeenCalled()
      expect(toastMocks.record).toHaveBeenCalledWith({
        type: 'error',
        message: 'app.notPublishedYet',
      })
    })
  })
})
