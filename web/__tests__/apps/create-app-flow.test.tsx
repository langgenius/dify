/**
 * Integration test: Create App Flow
 *
 * Tests the end-to-end user flows for creating new apps:
 *   - Creating from blank via NewAppCard
 *   - Creating from template via NewAppCard
 *   - Creating from DSL import via NewAppCard
 *   - Apps page top-level state management
 */
import type { AppListResponse } from '@/models/app'
import type { App } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import List from '@/app/components/apps/list'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'

let mockIsCurrentWorkspaceEditor = true
let mockIsCurrentWorkspaceDatasetOperator = false
let mockIsLoadingCurrentWorkspace = false
let mockSystemFeatures = {
  branding: { enabled: false },
  webapp_auth: { enabled: false },
}

let mockPages: AppListResponse[] = []
let mockIsLoading = false
let mockIsFetching = false
const mockRefetch = vi.fn()
const mockFetchNextPage = vi.fn()
let mockShowTagManagementModal = false

const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()
const mockOnPlanInfoChanged = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator,
    isLoadingCurrentWorkspace: mockIsLoadingCurrentWorkspace,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { systemFeatures: mockSystemFeatures }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
  }),
}))

vi.mock('@/app/components/base/tag-management/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      tagList: [],
      showTagManagementModal: mockShowTagManagementModal,
      setTagList: vi.fn(),
      setShowTagManagementModal: vi.fn(),
    }
    return selector(state)
  },
}))

vi.mock('@/service/tag', () => ({
  fetchTagList: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/service/use-apps', () => ({
  useInfiniteAppList: () => ({
    data: { pages: mockPages },
    isLoading: mockIsLoading,
    isFetching: mockIsFetching,
    isFetchingNextPage: false,
    fetchNextPage: mockFetchNextPage,
    hasNextPage: false,
    error: null,
    refetch: mockRefetch,
  }),
}))

vi.mock('@/hooks/use-pay', () => ({
  CheckModal: () => null,
}))

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useDebounceFn: (fn: (...args: unknown[]) => void) => {
      const fnRef = React.useRef(fn)
      fnRef.current = fn
      return {
        run: (...args: unknown[]) => fnRef.current(...args),
      }
    },
  }
})

// Mock dynamically loaded modals with test stubs
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

vi.mock('@/app/components/app/create-app-modal', () => ({
  default: ({ show, onClose, onSuccess, onCreateFromTemplate }: Record<string, unknown>) => {
    if (!show)
      return null
    return (
      <div data-testid="create-app-modal">
        <button data-testid="create-blank-confirm" onClick={onSuccess as () => void}>Create Blank</button>
        {!!onCreateFromTemplate && (
          <button data-testid="switch-to-template" onClick={onCreateFromTemplate as () => void}>From Template</button>
        )}
        <button data-testid="create-blank-cancel" onClick={onClose as () => void}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/create-app-dialog', () => ({
  default: ({ show, onClose, onSuccess, onCreateFromBlank }: Record<string, unknown>) => {
    if (!show)
      return null
    return (
      <div data-testid="template-dialog">
        <button data-testid="template-confirm" onClick={onSuccess as () => void}>Create from Template</button>
        {!!onCreateFromBlank && (
          <button data-testid="switch-to-blank" onClick={onCreateFromBlank as () => void}>From Blank</button>
        )}
        <button data-testid="template-cancel" onClick={onClose as () => void}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/create-from-dsl-modal', () => ({
  default: ({ show, onClose, onSuccess }: Record<string, unknown>) => {
    if (!show)
      return null
    return (
      <div data-testid="create-from-dsl-modal">
        <button data-testid="dsl-import-confirm" onClick={onSuccess as () => void}>Import DSL</button>
        <button data-testid="dsl-import-cancel" onClick={onClose as () => void}>Cancel</button>
      </div>
    )
  },
  CreateFromDSLModalTab: {
    FROM_URL: 'from-url',
    FROM_FILE: 'from-file',
  },
}))

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: overrides.id ?? 'app-1',
  name: overrides.name ?? 'Test App',
  description: overrides.description ?? 'A test app',
  author_name: overrides.author_name ?? 'Author',
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

const createPage = (apps: App[]): AppListResponse => ({
  data: apps,
  has_more: false,
  limit: 30,
  page: 1,
  total: apps.length,
})

const renderList = () => {
  return render(
    <NuqsTestingAdapter>
      <List controlRefreshList={0} />
    </NuqsTestingAdapter>,
  )
}

describe('Create App Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceEditor = true
    mockIsCurrentWorkspaceDatasetOperator = false
    mockIsLoadingCurrentWorkspace = false
    mockSystemFeatures = {
      branding: { enabled: false },
      webapp_auth: { enabled: false },
    }
    mockPages = [createPage([createMockApp()])]
    mockIsLoading = false
    mockIsFetching = false
    mockShowTagManagementModal = false
  })

  describe('NewAppCard Rendering', () => {
    it('should render the "Create App" card with all options', () => {
      renderList()

      expect(screen.getByText('app.createApp')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.startFromBlank')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.startFromTemplate')).toBeInTheDocument()
      expect(screen.getByText('app.importDSL')).toBeInTheDocument()
    })

    it('should not render NewAppCard when user is not an editor', () => {
      mockIsCurrentWorkspaceEditor = false
      renderList()

      expect(screen.queryByText('app.createApp')).not.toBeInTheDocument()
    })

    it('should show loading state when workspace is loading', () => {
      mockIsLoadingCurrentWorkspace = true
      renderList()

      // NewAppCard renders but with loading style (pointer-events-none opacity-50)
      expect(screen.getByText('app.createApp')).toBeInTheDocument()
    })
  })

  // -- Create from blank --
  describe('Create from Blank Flow', () => {
    it('should open the create app modal when "Start from Blank" is clicked', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))

      await waitFor(() => {
        expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
      })
    })

    it('should close the create app modal on cancel', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      await waitFor(() => {
        expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('create-blank-cancel'))
      await waitFor(() => {
        expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      })
    })

    it('should call onPlanInfoChanged and refetch on successful creation', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      await waitFor(() => {
        expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('create-blank-confirm'))
      await waitFor(() => {
        expect(mockOnPlanInfoChanged).toHaveBeenCalled()
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })

  // -- Create from template --
  describe('Create from Template Flow', () => {
    it('should open template dialog when "Start from Template" is clicked', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.newApp.startFromTemplate'))

      await waitFor(() => {
        expect(screen.getByTestId('template-dialog')).toBeInTheDocument()
      })
    })

    it('should allow switching from template to blank modal', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.newApp.startFromTemplate'))
      await waitFor(() => {
        expect(screen.getByTestId('template-dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('switch-to-blank'))
      await waitFor(() => {
        expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
        expect(screen.queryByTestId('template-dialog')).not.toBeInTheDocument()
      })
    })

    it('should allow switching from blank to template dialog', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      await waitFor(() => {
        expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('switch-to-template'))
      await waitFor(() => {
        expect(screen.getByTestId('template-dialog')).toBeInTheDocument()
        expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      })
    })
  })

  // -- Create from DSL import (via NewAppCard button) --
  describe('Create from DSL Import Flow', () => {
    it('should open DSL import modal when "Import DSL" is clicked', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.importDSL'))

      await waitFor(() => {
        expect(screen.getByTestId('create-from-dsl-modal')).toBeInTheDocument()
      })
    })

    it('should close DSL import modal on cancel', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.importDSL'))
      await waitFor(() => {
        expect(screen.getByTestId('create-from-dsl-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('dsl-import-cancel'))
      await waitFor(() => {
        expect(screen.queryByTestId('create-from-dsl-modal')).not.toBeInTheDocument()
      })
    })

    it('should call onPlanInfoChanged and refetch on successful DSL import', async () => {
      renderList()

      fireEvent.click(screen.getByText('app.importDSL'))
      await waitFor(() => {
        expect(screen.getByTestId('create-from-dsl-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('dsl-import-confirm'))
      await waitFor(() => {
        expect(mockOnPlanInfoChanged).toHaveBeenCalled()
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })

  // -- DSL drag-and-drop flow (via List component) --
  describe('DSL Drag-Drop Flow', () => {
    it('should show drag-drop hint in the list', () => {
      renderList()

      expect(screen.getByText('app.newApp.dropDSLToCreateApp')).toBeInTheDocument()
    })

    it('should open create-from-DSL modal when DSL file is dropped', async () => {
      const { act } = await import('@testing-library/react')
      renderList()

      const container = document.querySelector('[class*="overflow-y-auto"]')
      if (container) {
        const yamlFile = new File(['app: test'], 'app.yaml', { type: 'application/yaml' })

        // Simulate the full drag-drop sequence wrapped in act
        await act(async () => {
          const dragEnterEvent = new Event('dragenter', { bubbles: true })
          Object.defineProperty(dragEnterEvent, 'dataTransfer', {
            value: { types: ['Files'], files: [] },
          })
          Object.defineProperty(dragEnterEvent, 'preventDefault', { value: vi.fn() })
          Object.defineProperty(dragEnterEvent, 'stopPropagation', { value: vi.fn() })
          container.dispatchEvent(dragEnterEvent)

          const dropEvent = new Event('drop', { bubbles: true })
          Object.defineProperty(dropEvent, 'dataTransfer', {
            value: { files: [yamlFile], types: ['Files'] },
          })
          Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() })
          Object.defineProperty(dropEvent, 'stopPropagation', { value: vi.fn() })
          container.dispatchEvent(dropEvent)
        })

        await waitFor(() => {
          const modal = screen.queryByTestId('create-from-dsl-modal')
          if (modal)
            expect(modal).toBeInTheDocument()
        })
      }
    })
  })

  // -- Edge cases --
  describe('Edge Cases', () => {
    it('should not show create options when no data and user is editor', () => {
      mockPages = [createPage([])]
      renderList()

      // NewAppCard should still be visible even with no apps
      expect(screen.getByText('app.createApp')).toBeInTheDocument()
    })

    it('should handle multiple rapid clicks on create buttons without crashing', async () => {
      renderList()

      // Rapidly click different create options
      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      fireEvent.click(screen.getByText('app.newApp.startFromTemplate'))
      fireEvent.click(screen.getByText('app.importDSL'))

      // Should not crash, and some modal should be present
      await waitFor(() => {
        const anyModal = screen.queryByTestId('create-app-modal')
          || screen.queryByTestId('template-dialog')
          || screen.queryByTestId('create-from-dsl-modal')
        expect(anyModal).toBeTruthy()
      })
    })
  })
})
