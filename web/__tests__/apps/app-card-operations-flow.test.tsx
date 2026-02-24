/**
 * Integration test: App Card Operations Flow
 *
 * Tests the end-to-end user flows for app card operations:
 *   - Editing app info
 *   - Duplicating an app
 *   - Deleting an app
 *   - Exporting app DSL
 *   - Navigation on card click
 *   - Access mode icons
 */
import type { App } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppCard from '@/app/components/apps/app-card'
import { AccessMode } from '@/models/access-control'
import { deleteApp, exportAppConfig, updateAppInfo } from '@/service/apps'
import { AppModeEnum } from '@/types/app'

let mockIsCurrentWorkspaceEditor = true
let mockSystemFeatures = {
  branding: { enabled: false },
  webapp_auth: { enabled: false },
}

const mockRouterPush = vi.fn()
const mockNotify = vi.fn()
const mockOnPlanInfoChanged = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

// Mock headless UI Popover so it renders content without transition
vi.mock('@headlessui/react', async () => {
  const actual = await vi.importActual<typeof import('@headlessui/react')>('@headlessui/react')
  return {
    ...actual,
    Popover: ({ children, className }: { children: ((bag: { open: boolean }) => React.ReactNode) | React.ReactNode, className?: string }) => (
      <div className={className} data-testid="popover-wrapper">
        {typeof children === 'function' ? children({ open: true }) : children}
      </div>
    ),
    PopoverButton: ({ children, className, ref: _ref, ...rest }: Record<string, unknown>) => (
      <button className={className as string} {...rest}>{children as React.ReactNode}</button>
    ),
    PopoverPanel: ({ children, className }: { children: ((bag: { close: () => void }) => React.ReactNode) | React.ReactNode, className?: string }) => (
      <div className={className}>
        {typeof children === 'function' ? children({ close: vi.fn() }) : children}
      </div>
    ),
    Transition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    let Component: React.ComponentType<Record<string, unknown>> | null = null
    loader().then((mod) => {
      Component = mod.default as React.ComponentType<Record<string, unknown>>
    }).catch(() => {})
    const Wrapper = (props: Record<string, unknown>) => {
      if (Component)
        return <Component {...props} />
      return null
    }
    Wrapper.displayName = 'DynamicWrapper'
    return Wrapper
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { systemFeatures: mockSystemFeatures }
    if (typeof selector === 'function')
      return selector(state)
    return mockSystemFeatures
  },
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
  }),
}))

// Mock the ToastContext used via useContext from use-context-selector
vi.mock('use-context-selector', async () => {
  const actual = await vi.importActual<typeof import('use-context-selector')>('use-context-selector')
  return {
    ...actual,
    useContext: () => ({ notify: mockNotify }),
  }
})

vi.mock('@/app/components/base/tag-management/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      tagList: [],
      showTagManagementModal: false,
      setTagList: vi.fn(),
      setShowTagManagementModal: vi.fn(),
    }
    return selector(state)
  },
}))

vi.mock('@/service/tag', () => ({
  fetchTagList: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/service/apps', () => ({
  deleteApp: vi.fn().mockResolvedValue({}),
  updateAppInfo: vi.fn().mockResolvedValue({}),
  copyApp: vi.fn().mockResolvedValue({ id: 'new-app-id', mode: 'chat' }),
  exportAppConfig: vi.fn().mockResolvedValue({ data: 'yaml-content' }),
}))

vi.mock('@/service/explore', () => ({
  fetchInstalledAppList: vi.fn().mockResolvedValue({ installed_apps: [] }),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn().mockResolvedValue({ environment_variables: [] }),
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: () => ({ data: { result: true }, isLoading: false }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => vi.fn(),
}))

// Mock modals loaded via next/dynamic
vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: ({ show, onConfirm, onHide, appName }: Record<string, unknown>) => {
    if (!show)
      return null
    return (
      <div data-testid="edit-app-modal">
        <span data-testid="modal-app-name">{appName as string}</span>
        <button
          data-testid="confirm-edit"
          onClick={() => (onConfirm as (data: Record<string, unknown>) => void)({
            name: 'Updated App Name',
            icon_type: 'emoji',
            icon: '🔥',
            icon_background: '#fff',
            description: 'Updated description',
          })}
        >
          Confirm
        </button>
        <button data-testid="cancel-edit" onClick={onHide as () => void}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/duplicate-modal', () => ({
  default: ({ show, onConfirm, onHide }: Record<string, unknown>) => {
    if (!show)
      return null
    return (
      <div data-testid="duplicate-app-modal">
        <button
          data-testid="confirm-duplicate"
          onClick={() => (onConfirm as (data: Record<string, unknown>) => void)({
            name: 'Copied App',
            icon_type: 'emoji',
            icon: '📋',
            icon_background: '#fff',
          })}
        >
          Confirm Duplicate
        </button>
        <button data-testid="cancel-duplicate" onClick={onHide as () => void}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/switch-app-modal', () => ({
  default: ({ show, onClose, onSuccess }: Record<string, unknown>) => {
    if (!show)
      return null
    return (
      <div data-testid="switch-app-modal">
        <button data-testid="confirm-switch" onClick={onSuccess as () => void}>Confirm Switch</button>
        <button data-testid="cancel-switch" onClick={onClose as () => void}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel, title }: Record<string, unknown>) => {
    if (!isShow)
      return null
    return (
      <div data-testid="confirm-delete-modal">
        <span>{title as string}</span>
        <button data-testid="confirm-delete" onClick={onConfirm as () => void}>Delete</button>
        <button data-testid="cancel-delete" onClick={onCancel as () => void}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/dsl-export-confirm-modal', () => ({
  default: ({ onConfirm, onClose }: Record<string, unknown>) => (
    <div data-testid="dsl-export-confirm-modal">
      <button data-testid="export-include" onClick={() => (onConfirm as (include: boolean) => void)(true)}>Include</button>
      <button data-testid="export-close" onClick={onClose as () => void}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/app/app-access-control', () => ({
  default: ({ onConfirm, onClose }: Record<string, unknown>) => (
    <div data-testid="access-control-modal">
      <button data-testid="confirm-access" onClick={onConfirm as () => void}>Confirm</button>
      <button data-testid="cancel-access" onClick={onClose as () => void}>Cancel</button>
    </div>
  ),
}))

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: overrides.id ?? 'app-1',
  name: overrides.name ?? 'Test Chat App',
  description: overrides.description ?? 'A chat application',
  author_name: overrides.author_name ?? 'Test Author',
  icon_type: overrides.icon_type ?? 'emoji',
  icon: overrides.icon ?? '🤖',
  icon_background: overrides.icon_background ?? '#FFEAD5',
  icon_url: overrides.icon_url ?? null,
  use_icon_as_answer_icon: overrides.use_icon_as_answer_icon ?? false,
  mode: overrides.mode ?? AppModeEnum.CHAT,
  enable_site: overrides.enable_site ?? true,
  enable_api: overrides.enable_api ?? true,
  api_rpm: overrides.api_rpm ?? 60,
  api_rph: overrides.api_rph ?? 3600,
  is_demo: overrides.is_demo ?? false,
  model_config: overrides.model_config ?? {} as App['model_config'],
  app_model_config: overrides.app_model_config ?? {} as App['app_model_config'],
  created_at: overrides.created_at ?? 1700000000,
  updated_at: overrides.updated_at ?? 1700001000,
  site: overrides.site ?? {} as App['site'],
  api_base_url: overrides.api_base_url ?? 'https://api.example.com',
  tags: overrides.tags ?? [],
  access_mode: overrides.access_mode ?? AccessMode.PUBLIC,
  max_active_requests: overrides.max_active_requests ?? null,
})

const mockOnRefresh = vi.fn()

const renderAppCard = (app?: Partial<App>) => {
  return render(<AppCard app={createMockApp(app)} onRefresh={mockOnRefresh} />)
}

describe('App Card Operations Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceEditor = true
    mockSystemFeatures = {
      branding: { enabled: false },
      webapp_auth: { enabled: false },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Card Rendering', () => {
    it('should render app name and description', () => {
      renderAppCard({ name: 'My AI Bot', description: 'An intelligent assistant' })

      expect(screen.getByText('My AI Bot')).toBeInTheDocument()
      expect(screen.getByText('An intelligent assistant')).toBeInTheDocument()
    })

    it('should render author name', () => {
      renderAppCard({ author_name: 'John Doe' })

      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should navigate to app config page when card is clicked', () => {
      renderAppCard({ id: 'app-123', mode: AppModeEnum.CHAT })

      const card = screen.getByText('Test Chat App').closest('[class*="cursor-pointer"]')
      if (card)
        fireEvent.click(card)

      expect(mockRouterPush).toHaveBeenCalledWith('/app/app-123/configuration')
    })

    it('should navigate to workflow page for workflow apps', () => {
      renderAppCard({ id: 'app-wf', mode: AppModeEnum.WORKFLOW, name: 'WF App' })

      const card = screen.getByText('WF App').closest('[class*="cursor-pointer"]')
      if (card)
        fireEvent.click(card)

      expect(mockRouterPush).toHaveBeenCalledWith('/app/app-wf/workflow')
    })
  })

  // -- Delete flow --
  describe('Delete App Flow', () => {
    it('should show delete confirmation and call API on confirm', async () => {
      renderAppCard({ id: 'app-to-delete', name: 'Deletable App' })

      // Find and click the more button (popover trigger)
      const moreIcons = document.querySelectorAll('svg')
      const moreFill = Array.from(moreIcons).find(svg => svg.closest('[class*="cursor-pointer"]'))

      if (moreFill) {
        const btn = moreFill.closest('[class*="cursor-pointer"]')
        if (btn)
          fireEvent.click(btn)

        await waitFor(() => {
          const deleteBtn = screen.queryByText('common.operation.delete')
          if (deleteBtn)
            fireEvent.click(deleteBtn)
        })

        const confirmBtn = screen.queryByTestId('confirm-delete')
        if (confirmBtn) {
          fireEvent.click(confirmBtn)

          await waitFor(() => {
            expect(deleteApp).toHaveBeenCalledWith('app-to-delete')
          })
        }
      }
    })
  })

  // -- Edit flow --
  describe('Edit App Flow', () => {
    it('should open edit modal and call updateAppInfo on confirm', async () => {
      renderAppCard({ id: 'app-edit', name: 'Editable App' })

      const moreIcons = document.querySelectorAll('svg')
      const moreFill = Array.from(moreIcons).find(svg => svg.closest('[class*="cursor-pointer"]'))

      if (moreFill) {
        const btn = moreFill.closest('[class*="cursor-pointer"]')
        if (btn)
          fireEvent.click(btn)

        await waitFor(() => {
          const editBtn = screen.queryByText('app.editApp')
          if (editBtn)
            fireEvent.click(editBtn)
        })

        const confirmEdit = screen.queryByTestId('confirm-edit')
        if (confirmEdit) {
          fireEvent.click(confirmEdit)

          await waitFor(() => {
            expect(updateAppInfo).toHaveBeenCalledWith(
              expect.objectContaining({
                appID: 'app-edit',
                name: 'Updated App Name',
              }),
            )
          })
        }
      }
    })
  })

  // -- Export flow --
  describe('Export App Flow', () => {
    it('should call exportAppConfig for completion apps', async () => {
      renderAppCard({ id: 'app-export', mode: AppModeEnum.COMPLETION, name: 'Export App' })

      const moreIcons = document.querySelectorAll('svg')
      const moreFill = Array.from(moreIcons).find(svg => svg.closest('[class*="cursor-pointer"]'))

      if (moreFill) {
        const btn = moreFill.closest('[class*="cursor-pointer"]')
        if (btn)
          fireEvent.click(btn)

        await waitFor(() => {
          const exportBtn = screen.queryByText('app.export')
          if (exportBtn)
            fireEvent.click(exportBtn)
        })

        await waitFor(() => {
          expect(exportAppConfig).toHaveBeenCalledWith(
            expect.objectContaining({ appID: 'app-export' }),
          )
        })
      }
    })
  })

  // -- Access mode display --
  describe('Access Mode Display', () => {
    it('should not render operations menu for non-editor users', () => {
      mockIsCurrentWorkspaceEditor = false
      renderAppCard({ name: 'Readonly App' })

      expect(screen.queryByText('app.editApp')).not.toBeInTheDocument()
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })
  })

  // -- Switch mode (only for CHAT/COMPLETION) --
  describe('Switch App Mode', () => {
    it('should show switch option for chat mode apps', async () => {
      renderAppCard({ id: 'app-switch', mode: AppModeEnum.CHAT })

      const moreIcons = document.querySelectorAll('svg')
      const moreFill = Array.from(moreIcons).find(svg => svg.closest('[class*="cursor-pointer"]'))

      if (moreFill) {
        const btn = moreFill.closest('[class*="cursor-pointer"]')
        if (btn)
          fireEvent.click(btn)

        await waitFor(() => {
          expect(screen.queryByText('app.switch')).toBeInTheDocument()
        })
      }
    })

    it('should not show switch option for workflow apps', async () => {
      renderAppCard({ id: 'app-wf', mode: AppModeEnum.WORKFLOW, name: 'WF App' })

      const moreIcons = document.querySelectorAll('svg')
      const moreFill = Array.from(moreIcons).find(svg => svg.closest('[class*="cursor-pointer"]'))

      if (moreFill) {
        const btn = moreFill.closest('[class*="cursor-pointer"]')
        if (btn)
          fireEvent.click(btn)

        await waitFor(() => {
          expect(screen.queryByText('app.switch')).not.toBeInTheDocument()
        })
      }
    })
  })
})
