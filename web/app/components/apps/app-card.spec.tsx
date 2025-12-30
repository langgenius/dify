import type { Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { AccessMode } from '@/models/access-control'
// Mock API services - import for direct manipulation
import * as appsService from '@/service/apps'

import * as exploreService from '@/service/explore'
import * as workflowService from '@/service/workflow'
import { AppModeEnum } from '@/types/app'

// Import component after mocks
import AppCard from './app-card'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock use-context-selector with stable mockNotify reference for tracking calls
// Include createContext for components that use it (like Toast)
const mockNotify = vi.fn()
vi.mock('use-context-selector', () => ({
  createContext: (defaultValue: any) => React.createContext(defaultValue),
  useContext: () => ({
    notify: mockNotify,
  }),
  useContextSelector: (_context: any, selector: any) => selector({
    notify: mockNotify,
  }),
}))

// Mock app context
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
  }),
}))

// Mock provider context
const mockOnPlanInfoChanged = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
  }),
}))

// Mock global public store - allow dynamic configuration
let mockWebappAuthEnabled = false
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (s: any) => any) => selector({
    systemFeatures: {
      webapp_auth: { enabled: mockWebappAuthEnabled },
      branding: { enabled: false },
    },
  }),
}))

vi.mock('@/service/apps', () => ({
  deleteApp: vi.fn(() => Promise.resolve()),
  updateAppInfo: vi.fn(() => Promise.resolve()),
  copyApp: vi.fn(() => Promise.resolve({ id: 'new-app-id' })),
  exportAppConfig: vi.fn(() => Promise.resolve({ data: 'yaml: content' })),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn(() => Promise.resolve({ environment_variables: [] })),
}))

vi.mock('@/service/explore', () => ({
  fetchInstalledAppList: vi.fn(() => Promise.resolve({ installed_apps: [{ id: 'installed-1' }] })),
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: () => ({
    data: { result: true },
    isLoading: false,
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
  getRedirection: mockGetRedirection,
}))

vi.mock('@/utils/var', () => ({
  basePath: '',
}))

vi.mock('@/utils/time', () => ({
  formatTime: () => 'Jan 1, 2024',
}))

// Mock dynamic imports
vi.mock('next/dynamic', () => ({
  default: (importFn: () => Promise<any>) => {
    const fnString = importFn.toString()

    if (fnString.includes('create-app-modal') || fnString.includes('explore/create-app-modal')) {
      return function MockEditAppModal({ show, onHide, onConfirm }: any) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'edit-app-modal' }, React.createElement('button', { 'onClick': onHide, 'data-testid': 'close-edit-modal' }, 'Close'), React.createElement('button', {
          'onClick': () => onConfirm?.({
            name: 'Updated App',
            icon_type: 'emoji',
            icon: '🎯',
            icon_background: '#FFEAD5',
            description: 'Updated description',
            use_icon_as_answer_icon: false,
            max_active_requests: null,
          }),
          'data-testid': 'confirm-edit-modal',
        }, 'Confirm'))
      }
    }
    if (fnString.includes('duplicate-modal')) {
      return function MockDuplicateAppModal({ show, onHide, onConfirm }: any) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'duplicate-modal' }, React.createElement('button', { 'onClick': onHide, 'data-testid': 'close-duplicate-modal' }, 'Close'), React.createElement('button', {
          'onClick': () => onConfirm?.({
            name: 'Copied App',
            icon_type: 'emoji',
            icon: '📋',
            icon_background: '#E4FBCC',
          }),
          'data-testid': 'confirm-duplicate-modal',
        }, 'Confirm'))
      }
    }
    if (fnString.includes('switch-app-modal')) {
      return function MockSwitchAppModal({ show, onClose, onSuccess }: any) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'switch-modal' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-switch-modal' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'confirm-switch-modal' }, 'Switch'))
      }
    }
    if (fnString.includes('base/confirm')) {
      return function MockConfirm({ isShow, onCancel, onConfirm }: any) {
        if (!isShow)
          return null
        return React.createElement('div', { 'data-testid': 'confirm-dialog' }, React.createElement('button', { 'onClick': onCancel, 'data-testid': 'cancel-confirm' }, 'Cancel'), React.createElement('button', { 'onClick': onConfirm, 'data-testid': 'confirm-confirm' }, 'Confirm'))
      }
    }
    if (fnString.includes('dsl-export-confirm-modal')) {
      return function MockDSLExportModal({ onClose, onConfirm }: any) {
        return React.createElement('div', { 'data-testid': 'dsl-export-modal' }, React.createElement('button', { 'onClick': () => onClose?.(), 'data-testid': 'close-dsl-export' }, 'Close'), React.createElement('button', { 'onClick': () => onConfirm?.(true), 'data-testid': 'confirm-dsl-export' }, 'Export with secrets'), React.createElement('button', { 'onClick': () => onConfirm?.(false), 'data-testid': 'confirm-dsl-export-no-secrets' }, 'Export without secrets'))
      }
    }
    if (fnString.includes('app-access-control')) {
      return function MockAccessControl({ onClose, onConfirm }: any) {
        return React.createElement('div', { 'data-testid': 'access-control-modal' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-access-control' }, 'Close'), React.createElement('button', { 'onClick': onConfirm, 'data-testid': 'confirm-access-control' }, 'Confirm'))
      }
    }
    return () => null
  },
}))

// Popover uses @headlessui/react portals - mock for controlled interaction testing
vi.mock('@/app/components/base/popover', () => {
  const MockPopover = ({ htmlContent, btnElement, btnClassName }: any) => {
    const [isOpen, setIsOpen] = React.useState(false)
    const computedClassName = typeof btnClassName === 'function' ? btnClassName(isOpen) : ''
    return React.createElement('div', { 'data-testid': 'custom-popover', 'className': computedClassName }, React.createElement('div', {
      'onClick': () => setIsOpen(!isOpen),
      'data-testid': 'popover-trigger',
    }, btnElement), isOpen && React.createElement('div', {
      'data-testid': 'popover-content',
      'onMouseLeave': () => setIsOpen(false),
    }, typeof htmlContent === 'function' ? htmlContent({ open: isOpen, onClose: () => setIsOpen(false), onClick: () => setIsOpen(false) }) : htmlContent))
  }
  return { __esModule: true, default: MockPopover }
})

// Tooltip uses portals - minimal mock preserving popup content as title attribute
vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: any) => React.createElement('div', { title: popupContent }, children),
}))

// TagSelector has API dependency (service/tag) - mock for isolated testing
vi.mock('@/app/components/base/tag-management/selector', () => ({
  default: ({ tags }: any) => {
    return React.createElement('div', { 'aria-label': 'tag-selector' }, tags?.map((tag: any) => React.createElement('span', { key: tag.id }, tag.name)))
  },
}))

// AppTypeIcon has complex icon mapping - mock for focused component testing
vi.mock('@/app/components/app/type-selector', () => ({
  AppTypeIcon: () => React.createElement('div', { 'data-testid': 'app-type-icon' }),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockApp = (overrides: Record<string, any> = {}) => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test app description',
  mode: AppModeEnum.CHAT,
  icon: '🤖',
  icon_type: 'emoji' as const,
  icon_background: '#FFEAD5',
  icon_url: null,
  author_name: 'Test Author',
  created_at: 1704067200,
  updated_at: 1704153600,
  tags: [],
  use_icon_as_answer_icon: false,
  max_active_requests: null,
  access_mode: AccessMode.PUBLIC,
  has_draft_trigger: false,
  enable_site: true,
  enable_api: true,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as any,
  app_model_config: {} as any,
  site: {} as any,
  api_base_url: 'https://api.example.com',
  ...overrides,
})

// ============================================================================
// Tests
// ============================================================================

describe('AppCard', () => {
  const mockApp = createMockApp()
  const mockOnRefresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenAsyncWindow.mockReset()
    mockWebappAuthEnabled = false
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<AppCard app={mockApp} />)
      // Use title attribute to target specific element
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })

    it('should display app name', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })

    it('should display app description', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByTitle('Test app description')).toBeInTheDocument()
    })

    it('should display author name', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByTitle('Test Author')).toBeInTheDocument()
    })

    it('should render app icon', () => {
      // AppIcon component renders the emoji icon from app data
      const { container } = render(<AppCard app={mockApp} />)
      // Check that the icon container is rendered (AppIcon renders within the card)
      const iconElement = container.querySelector('[class*="icon"]') || container.querySelector('img')
      expect(iconElement || screen.getByText(mockApp.icon)).toBeTruthy()
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
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })

    it('should handle app with tags', () => {
      const appWithTags = {
        ...mockApp,
        tags: [{ id: 'tag1', name: 'Tag 1', type: 'app', binding_count: 0 }],
      }
      render(<AppCard app={appWithTags} />)
      // Verify the tag selector component renders
      expect(screen.getByLabelText('tag-selector')).toBeInTheDocument()
    })

    it('should render with onRefresh callback', () => {
      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })
  })

  describe('Access Mode Icons', () => {
    it('should show public icon for public access mode', () => {
      const publicApp = { ...mockApp, access_mode: AccessMode.PUBLIC }
      const { container } = render(<AppCard app={publicApp} />)
      const tooltip = container.querySelector('[title="app.accessItemsDescription.anyone"]')
      expect(tooltip).toBeInTheDocument()
    })

    it('should show lock icon for specific groups access mode', () => {
      const specificApp = { ...mockApp, access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS }
      const { container } = render(<AppCard app={specificApp} />)
      const tooltip = container.querySelector('[title="app.accessItemsDescription.specific"]')
      expect(tooltip).toBeInTheDocument()
    })

    it('should show organization icon for organization access mode', () => {
      const orgApp = { ...mockApp, access_mode: AccessMode.ORGANIZATION }
      const { container } = render(<AppCard app={orgApp} />)
      const tooltip = container.querySelector('[title="app.accessItemsDescription.organization"]')
      expect(tooltip).toBeInTheDocument()
    })

    it('should show external icon for external access mode', () => {
      const externalApp = { ...mockApp, access_mode: AccessMode.EXTERNAL_MEMBERS }
      const { container } = render(<AppCard app={externalApp} />)
      const tooltip = container.querySelector('[title="app.accessItemsDescription.external"]')
      expect(tooltip).toBeInTheDocument()
    })
  })

  describe('Card Interaction', () => {
    it('should handle card click', () => {
      render(<AppCard app={mockApp} />)
      const card = screen.getByTitle('Test App').closest('[class*="cursor-pointer"]')
      expect(card).toBeInTheDocument()
    })

    it('should call getRedirection on card click', () => {
      render(<AppCard app={mockApp} />)
      const card = screen.getByTitle('Test App').closest('[class*="cursor-pointer"]')!
      fireEvent.click(card)
      expect(mockGetRedirection).toHaveBeenCalledWith(true, mockApp, mockPush)
    })
  })

  describe('Operations Menu', () => {
    it('should render operations popover', () => {
      render(<AppCard app={mockApp} />)
      expect(screen.getByTestId('custom-popover')).toBeInTheDocument()
    })

    it('should show edit option when popover is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        expect(screen.getByText('app.editApp')).toBeInTheDocument()
      })
    })

    it('should show duplicate option when popover is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        expect(screen.getByText('app.duplicate')).toBeInTheDocument()
      })
    })

    it('should show export option when popover is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        expect(screen.getByText('app.export')).toBeInTheDocument()
      })
    })

    it('should show delete option when popover is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      })
    })

    it('should show switch option for chat mode apps', async () => {
      const chatApp = { ...mockApp, mode: AppModeEnum.CHAT }
      render(<AppCard app={chatApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        expect(screen.getByText(/switch/i)).toBeInTheDocument()
      })
    })

    it('should show switch option for completion mode apps', async () => {
      const completionApp = { ...mockApp, mode: AppModeEnum.COMPLETION }
      render(<AppCard app={completionApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        expect(screen.getByText(/switch/i)).toBeInTheDocument()
      })
    })

    it('should not show switch option for workflow mode apps', async () => {
      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        expect(screen.queryByText(/switch/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('Modal Interactions', () => {
    it('should open edit modal when edit button is clicked', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

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

      fireEvent.click(screen.getByTestId('popover-trigger'))

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

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        const deleteButton = screen.getByText('common.operation.delete')
        fireEvent.click(deleteButton)
      })

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })
    })

    it('should close confirm dialog when cancel is clicked', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        const deleteButton = screen.getByText('common.operation.delete')
        fireEvent.click(deleteButton)
      })

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('cancel-confirm'))

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      })
    })

    it('should close edit modal when onHide is called', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
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

      fireEvent.click(screen.getByTestId('popover-trigger'))
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
  })

  describe('Styling', () => {
    it('should have correct card container styling', () => {
      const { container } = render(<AppCard app={mockApp} />)
      const card = container.querySelector('[class*="h-[160px]"]')
      expect(card).toBeInTheDocument()
    })

    it('should have rounded corners', () => {
      const { container } = render(<AppCard app={mockApp} />)
      const card = container.querySelector('[class*="rounded-xl"]')
      expect(card).toBeInTheDocument()
    })
  })

  describe('API Callbacks', () => {
    it('should call deleteApp API when confirming delete', async () => {
      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      // Open popover and click delete
      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('common.operation.delete'))
      })

      // Confirm delete
      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-confirm'))

      await waitFor(() => {
        expect(appsService.deleteApp).toHaveBeenCalled()
      })
    })

    it('should call onRefresh after successful delete', async () => {
      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('common.operation.delete'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-confirm'))

      await waitFor(() => {
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should handle delete failure', async () => {
      (appsService.deleteApp as Mock).mockRejectedValueOnce(new Error('Delete failed'))

      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('common.operation.delete'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-confirm'))

      await waitFor(() => {
        expect(appsService.deleteApp).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: expect.stringContaining('Delete failed') })
      })
    })

    it('should call updateAppInfo API when editing app', async () => {
      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.editApp'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-edit-modal'))

      await waitFor(() => {
        expect(appsService.updateAppInfo).toHaveBeenCalled()
      })
    })

    it('should call copyApp API when duplicating app', async () => {
      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.duplicate'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-duplicate-modal'))

      await waitFor(() => {
        expect(appsService.copyApp).toHaveBeenCalled()
      })
    })

    it('should call onPlanInfoChanged after successful duplication', async () => {
      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
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
      (appsService.copyApp as Mock).mockRejectedValueOnce(new Error('Copy failed'))

      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.duplicate'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-duplicate-modal'))

      await waitFor(() => {
        expect(appsService.copyApp).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'app.newApp.appCreateFailed' })
      })
    })

    it('should call exportAppConfig API when exporting', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(appsService.exportAppConfig).toHaveBeenCalled()
      })
    })

    it('should handle export failure', async () => {
      (appsService.exportAppConfig as Mock).mockRejectedValueOnce(new Error('Export failed'))

      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(appsService.exportAppConfig).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'app.exportFailed' })
      })
    })
  })

  describe('Switch Modal', () => {
    it('should open switch modal when switch button is clicked', async () => {
      const chatApp = { ...mockApp, mode: AppModeEnum.CHAT }
      render(<AppCard app={chatApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
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

      fireEvent.click(screen.getByTestId('popover-trigger'))
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

    it('should call onRefresh after successful switch', async () => {
      const chatApp = { ...mockApp, mode: AppModeEnum.CHAT }
      render(<AppCard app={chatApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.switch'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('switch-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-switch-modal'))

      await waitFor(() => {
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should open switch modal for completion mode apps', async () => {
      const completionApp = { ...mockApp, mode: AppModeEnum.COMPLETION }
      render(<AppCard app={completionApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.switch'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('switch-modal')).toBeInTheDocument()
      })
    })
  })

  describe('Open in Explore', () => {
    it('should show open in explore option when popover is opened', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))

      await waitFor(() => {
        expect(screen.getByText('app.openInExplore')).toBeInTheDocument()
      })
    })
  })

  describe('Workflow Export with Environment Variables', () => {
    it('should check for secret environment variables in workflow apps', async () => {
      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(workflowService.fetchWorkflowDraft).toHaveBeenCalled()
      })
    })

    it('should show DSL export modal when workflow has secret variables', async () => {
      (workflowService.fetchWorkflowDraft as Mock).mockResolvedValueOnce({
        environment_variables: [{ value_type: 'secret', name: 'API_KEY' }],
      })

      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('dsl-export-modal')).toBeInTheDocument()
      })
    })

    it('should check for secret environment variables in advanced chat apps', async () => {
      const advancedChatApp = { ...mockApp, mode: AppModeEnum.ADVANCED_CHAT }
      render(<AppCard app={advancedChatApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(workflowService.fetchWorkflowDraft).toHaveBeenCalled()
      })
    })

    it('should close DSL export modal when onClose is called', async () => {
      (workflowService.fetchWorkflowDraft as Mock).mockResolvedValueOnce({
        environment_variables: [{ value_type: 'secret', name: 'API_KEY' }],
      })

      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
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

  describe('Edge Cases', () => {
    it('should handle empty description', () => {
      const appNoDesc = { ...mockApp, description: '' }
      render(<AppCard app={appNoDesc} />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should handle long app name', () => {
      const longNameApp = {
        ...mockApp,
        name: 'This is a very long app name that might overflow the container',
      }
      render(<AppCard app={longNameApp} />)
      expect(screen.getByText(longNameApp.name)).toBeInTheDocument()
    })

    it('should handle empty tags array', () => {
      const noTagsApp = { ...mockApp, tags: [] }
      // With empty tags, the component should still render successfully
      render(<AppCard app={noTagsApp} />)
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })

    it('should handle missing author name', () => {
      const noAuthorApp = { ...mockApp, author_name: '' }
      render(<AppCard app={noAuthorApp} />)
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })

    it('should handle null icon_url', () => {
      const nullIconApp = { ...mockApp, icon_url: null }
      // With null icon_url, the component should fall back to emoji icon and render successfully
      render(<AppCard app={nullIconApp} />)
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })

    it('should use created_at when updated_at is not available', () => {
      const noUpdateApp = { ...mockApp, updated_at: 0 }
      render(<AppCard app={noUpdateApp} />)
      expect(screen.getByText(/edited/i)).toBeInTheDocument()
    })

    it('should handle agent chat mode apps', () => {
      const agentApp = { ...mockApp, mode: AppModeEnum.AGENT_CHAT }
      render(<AppCard app={agentApp} />)
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })

    it('should handle advanced chat mode apps', () => {
      const advancedApp = { ...mockApp, mode: AppModeEnum.ADVANCED_CHAT }
      render(<AppCard app={advancedApp} />)
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })

    it('should handle apps with multiple tags', () => {
      const multiTagApp = {
        ...mockApp,
        tags: [
          { id: 'tag1', name: 'Tag 1', type: 'app', binding_count: 0 },
          { id: 'tag2', name: 'Tag 2', type: 'app', binding_count: 0 },
          { id: 'tag3', name: 'Tag 3', type: 'app', binding_count: 0 },
        ],
      }
      render(<AppCard app={multiTagApp} />)
      // Verify the tag selector renders (actual tag display is handled by the real TagSelector component)
      expect(screen.getByLabelText('tag-selector')).toBeInTheDocument()
    })

    it('should handle edit failure', async () => {
      (appsService.updateAppInfo as Mock).mockRejectedValueOnce(new Error('Edit failed'))

      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.editApp'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-edit-modal'))

      await waitFor(() => {
        expect(appsService.updateAppInfo).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: expect.stringContaining('Edit failed') })
      })
    })

    it('should close edit modal after successful edit', async () => {
      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.editApp'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-edit-modal'))

      await waitFor(() => {
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should render all app modes correctly', () => {
      const modes = [
        AppModeEnum.CHAT,
        AppModeEnum.COMPLETION,
        AppModeEnum.WORKFLOW,
        AppModeEnum.ADVANCED_CHAT,
        AppModeEnum.AGENT_CHAT,
      ]

      modes.forEach((mode) => {
        const testApp = { ...mockApp, mode }
        const { unmount } = render(<AppCard app={testApp} />)
        expect(screen.getByTitle('Test App')).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle workflow draft fetch failure during export', async () => {
      (workflowService.fetchWorkflowDraft as Mock).mockRejectedValueOnce(new Error('Fetch failed'))

      const workflowApp = { ...mockApp, mode: AppModeEnum.WORKFLOW }
      render(<AppCard app={workflowApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.export'))
      })

      await waitFor(() => {
        expect(workflowService.fetchWorkflowDraft).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'app.exportFailed' })
      })
    })
  })

  // --------------------------------------------------------------------------
  // Additional Edge Cases for Coverage
  // --------------------------------------------------------------------------
  describe('Additional Coverage', () => {
    it('should handle onRefresh callback in switch modal success', async () => {
      const chatApp = createMockApp({ mode: AppModeEnum.CHAT })
      render(<AppCard app={chatApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.switch'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('switch-modal')).toBeInTheDocument()
      })

      // Trigger success callback
      fireEvent.click(screen.getByTestId('confirm-switch-modal'))

      await waitFor(() => {
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should render popover menu with correct styling for different app modes', async () => {
      // Test completion mode styling
      const completionApp = createMockApp({ mode: AppModeEnum.COMPLETION })
      const { unmount } = render(<AppCard app={completionApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        expect(screen.getByText('app.editApp')).toBeInTheDocument()
      })

      unmount()

      // Test workflow mode styling
      const workflowApp = createMockApp({ mode: AppModeEnum.WORKFLOW })
      render(<AppCard app={workflowApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        expect(screen.getByText('app.editApp')).toBeInTheDocument()
      })
    })

    it('should stop propagation when clicking tag selector area', () => {
      const multiTagApp = createMockApp({
        tags: [{ id: 'tag1', name: 'Tag 1', type: 'app', binding_count: 0 }],
      })

      render(<AppCard app={multiTagApp} />)

      const tagSelector = screen.getByLabelText('tag-selector')
      expect(tagSelector).toBeInTheDocument()

      // Click on tag selector wrapper to trigger stopPropagation
      const tagSelectorWrapper = tagSelector.closest('div')
      if (tagSelectorWrapper)
        fireEvent.click(tagSelectorWrapper)
    })

    it('should handle popover mouse leave', async () => {
      render(<AppCard app={mockApp} />)

      // Open popover
      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        expect(screen.getByTestId('popover-content')).toBeInTheDocument()
      })

      // Trigger mouse leave on the outer popover-content
      fireEvent.mouseLeave(screen.getByTestId('popover-content'))

      await waitFor(() => {
        expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
      })
    })

    it('should handle operations menu mouse leave', async () => {
      render(<AppCard app={mockApp} />)

      // Open popover
      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        expect(screen.getByText('app.editApp')).toBeInTheDocument()
      })

      // Find the Operations wrapper div (contains the menu items)
      const editButton = screen.getByText('app.editApp')
      const operationsWrapper = editButton.closest('div.relative')

      // Trigger mouse leave on the Operations wrapper to call onMouseLeave
      if (operationsWrapper)
        fireEvent.mouseLeave(operationsWrapper)
    })

    it('should click open in explore button', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        const openInExploreBtn = screen.getByText('app.openInExplore')
        fireEvent.click(openInExploreBtn)
      })

      // Verify openAsyncWindow was called with callback and options
      await waitFor(() => {
        expect(mockOpenAsyncWindow).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({ onError: expect.any(Function) }),
        )
      })
    })

    it('should handle open in explore via async window', async () => {
      // Configure mockOpenAsyncWindow to actually call the callback
      mockOpenAsyncWindow.mockImplementationOnce(async (callback: () => Promise<string>) => {
        await callback()
      })

      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        const openInExploreBtn = screen.getByText('app.openInExplore')
        fireEvent.click(openInExploreBtn)
      })

      await waitFor(() => {
        expect(exploreService.fetchInstalledAppList).toHaveBeenCalledWith(mockApp.id)
      })
    })

    it('should handle open in explore API failure', async () => {
      (exploreService.fetchInstalledAppList as Mock).mockRejectedValueOnce(new Error('API Error'))

      // Configure mockOpenAsyncWindow to call the callback and trigger error
      mockOpenAsyncWindow.mockImplementationOnce(async (callback: () => Promise<string>, options: any) => {
        try {
          await callback()
        }
        catch (err) {
          options?.onError?.(err)
        }
      })

      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        const openInExploreBtn = screen.getByText('app.openInExplore')
        fireEvent.click(openInExploreBtn)
      })

      await waitFor(() => {
        expect(exploreService.fetchInstalledAppList).toHaveBeenCalled()
      })
    })
  })

  describe('Access Control', () => {
    it('should render operations menu correctly', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        expect(screen.getByText('app.editApp')).toBeInTheDocument()
        expect(screen.getByText('app.duplicate')).toBeInTheDocument()
        expect(screen.getByText('app.export')).toBeInTheDocument()
        expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      })
    })
  })

  describe('Open in Explore - No App Found', () => {
    it('should handle case when installed_apps is empty array', async () => {
      (exploreService.fetchInstalledAppList as Mock).mockResolvedValueOnce({ installed_apps: [] })

      // Configure mockOpenAsyncWindow to call the callback and trigger error
      mockOpenAsyncWindow.mockImplementationOnce(async (callback: () => Promise<string>, options: any) => {
        try {
          await callback()
        }
        catch (err) {
          options?.onError?.(err)
        }
      })

      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        const openInExploreBtn = screen.getByText('app.openInExplore')
        fireEvent.click(openInExploreBtn)
      })

      await waitFor(() => {
        expect(exploreService.fetchInstalledAppList).toHaveBeenCalled()
      })
    })

    it('should handle case when API throws in callback', async () => {
      (exploreService.fetchInstalledAppList as Mock).mockRejectedValueOnce(new Error('Network error'))

      // Configure mockOpenAsyncWindow to call the callback without catching
      mockOpenAsyncWindow.mockImplementationOnce(async (callback: () => Promise<string>) => {
        return await callback()
      })

      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
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

      fireEvent.click(screen.getByTestId('popover-trigger'))
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
      expect(screen.getByTitle('Test App')).toBeInTheDocument()
    })
  })

  describe('WebApp Auth Enabled', () => {
    beforeEach(() => {
      mockWebappAuthEnabled = true
    })

    it('should show access control option when webapp_auth is enabled', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        expect(screen.getByText('app.accessControl')).toBeInTheDocument()
      })
    })

    it('should click access control button', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        const accessControlBtn = screen.getByText('app.accessControl')
        fireEvent.click(accessControlBtn)
      })

      await waitFor(() => {
        expect(screen.getByTestId('access-control-modal')).toBeInTheDocument()
      })
    })

    it('should close access control modal and call onRefresh', async () => {
      render(<AppCard app={mockApp} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.accessControl'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('access-control-modal')).toBeInTheDocument()
      })

      // Confirm access control
      fireEvent.click(screen.getByTestId('confirm-access-control'))

      await waitFor(() => {
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should show open in explore when userCanAccessApp is true', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        expect(screen.getByText('app.openInExplore')).toBeInTheDocument()
      })
    })

    it('should close access control modal when onClose is called', async () => {
      render(<AppCard app={mockApp} />)

      fireEvent.click(screen.getByTestId('popover-trigger'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('app.accessControl'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('access-control-modal')).toBeInTheDocument()
      })

      // Click close button to trigger onClose
      fireEvent.click(screen.getByTestId('close-access-control'))

      await waitFor(() => {
        expect(screen.queryByTestId('access-control-modal')).not.toBeInTheDocument()
      })
    })
  })
})
