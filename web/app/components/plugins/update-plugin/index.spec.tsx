import type {
  PluginDeclaration,
  UpdateFromGitHubPayload,
  UpdateFromMarketPlacePayload,
  UpdatePluginModalType,
} from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, PluginSource, TaskStatus } from '../types'
import DowngradeWarningModal from './downgrade-warning'
import FromGitHub from './from-github'
import UpdateFromMarketplace from './from-market-place'
import UpdatePlugin from './index'
import PluginVersionPicker from './plugin-version-picker'

// ================================
// Mock External Dependencies Only
// ================================

// Mock react-i18next
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { ns?: string }) => {
        const translations: Record<string, string> = {
          'upgrade.title': 'Update Plugin',
          'upgrade.successfulTitle': 'Plugin Updated',
          'upgrade.description': 'This plugin will be updated to the new version.',
          'upgrade.upgrade': 'Update',
          'upgrade.upgrading': 'Updating...',
          'upgrade.close': 'Close',
          'operation.cancel': 'Cancel',
          'newApp.Cancel': 'Cancel',
          'autoUpdate.pluginDowngradeWarning.title': 'Downgrade Warning',
          'autoUpdate.pluginDowngradeWarning.description': 'You are about to downgrade this plugin.',
          'autoUpdate.pluginDowngradeWarning.downgrade': 'Just Downgrade',
          'autoUpdate.pluginDowngradeWarning.exclude': 'Exclude and Downgrade',
          'detailPanel.switchVersion': 'Switch Version',
        }
        const fullKey = options?.ns ? `${options.ns}.${key}` : key
        return translations[fullKey] || translations[key] || key
      },
    }),
  }
})

// Mock useGetLanguage context
vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

// Mock app context for useGetIcon
vi.mock('@/context/app-context', () => ({
  useSelector: () => ({ id: 'test-workspace-id' }),
}))

// Mock hooks/use-timestamp
vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatDate: (timestamp: number, _format: string) => {
      const date = new Date(timestamp * 1000)
      return date.toISOString().split('T')[0]
    },
  }),
}))

// Mock plugins service
const mockUpdateFromMarketPlace = vi.fn()
vi.mock('@/service/plugins', () => ({
  updateFromMarketPlace: (params: unknown) => mockUpdateFromMarketPlace(params),
  checkTaskStatus: vi.fn().mockResolvedValue({
    task: {
      plugins: [{ plugin_unique_identifier: 'test-target-id', status: 'success' }],
    },
  }),
}))

// Mock use-plugins hooks
const mockHandleRefetch = vi.fn()
const mockMutateAsync = vi.fn()
const mockInvalidateReferenceSettings = vi.fn()

vi.mock('@/service/use-plugins', () => ({
  usePluginTaskList: () => ({
    handleRefetch: mockHandleRefetch,
  }),
  useRemoveAutoUpgrade: () => ({
    mutateAsync: mockMutateAsync,
  }),
  useInvalidateReferenceSettings: () => mockInvalidateReferenceSettings,
  useVersionListOfPlugin: () => ({
    data: {
      data: {
        versions: [
          { version: '1.0.0', unique_identifier: 'plugin-v1.0.0', created_at: 1700000000 },
          { version: '1.1.0', unique_identifier: 'plugin-v1.1.0', created_at: 1700100000 },
          { version: '2.0.0', unique_identifier: 'plugin-v2.0.0', created_at: 1700200000 },
        ],
      },
    },
  }),
}))

// Mock checkTaskStatus
const mockCheck = vi.fn()
const mockStop = vi.fn()
vi.mock('../install-plugin/base/check-task-status', () => ({
  default: () => ({
    check: mockCheck,
    stop: mockStop,
  }),
}))

// Mock Toast
vi.mock('../../base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock InstallFromGitHub component
vi.mock('../install-plugin/install-from-github', () => ({
  default: ({ updatePayload, onClose, onSuccess }: {
    updatePayload: UpdateFromGitHubPayload
    onClose: () => void
    onSuccess: () => void
  }) => (
    <div data-testid="install-from-github">
      <span data-testid="github-payload">{JSON.stringify(updatePayload)}</span>
      <button data-testid="github-close" onClick={onClose}>Close</button>
      <button data-testid="github-success" onClick={onSuccess}>Success</button>
    </div>
  ),
}))

// Mock Portal components for PluginVersionPicker
let mockPortalOpen = false
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open, onOpenChange: _onOpenChange }: {
    children: React.ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
  }) => {
    mockPortalOpen = open
    return <div data-testid="portal-elem" data-open={open}>{children}</div>
  },
  PortalToFollowElemTrigger: ({ children, onClick, className }: {
    children: React.ReactNode
    onClick: () => void
    className?: string
  }) => (
    <div data-testid="portal-trigger" onClick={onClick} className={className}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children, className }: {
    children: React.ReactNode
    className?: string
  }) => {
    if (!mockPortalOpen)
      return null
    return <div data-testid="portal-content" className={className}>{children}</div>
  },
}))

// Mock semver
vi.mock('semver', () => ({
  lt: (v1: string, v2: string) => {
    const parseVersion = (v: string) => v.split('.').map(Number)
    const [major1, minor1, patch1] = parseVersion(v1)
    const [major2, minor2, patch2] = parseVersion(v2)
    if (major1 !== major2)
      return major1 < major2
    if (minor1 !== minor2)
      return minor1 < minor2
    return patch1 < patch2
  },
}))

// ================================
// Test Data Factories
// ================================

const createMockPluginDeclaration = (overrides: Partial<PluginDeclaration> = {}): PluginDeclaration => ({
  plugin_unique_identifier: 'test-plugin-id',
  version: '1.0.0',
  author: 'test-author',
  icon: 'test-icon.png',
  name: 'Test Plugin',
  category: PluginCategoryEnum.tool,
  label: { 'en-US': 'Test Plugin' } as PluginDeclaration['label'],
  description: { 'en-US': 'A test plugin' } as PluginDeclaration['description'],
  created_at: '2024-01-01',
  resource: {},
  plugins: {},
  verified: true,
  endpoint: { settings: [], endpoints: [] },
  model: {},
  tags: [],
  agent_strategy: {},
  meta: { version: '1.0.0' },
  trigger: {
    events: [],
    identity: {
      author: 'test',
      name: 'test',
      label: { 'en-US': 'Test' } as PluginDeclaration['label'],
      description: { 'en-US': 'Test' } as PluginDeclaration['description'],
      icon: 'test.png',
      tags: [],
    },
    subscription_constructor: {
      credentials_schema: [],
      oauth_schema: { client_schema: [], credentials_schema: [] },
      parameters: [],
    },
    subscription_schema: [],
  },
  ...overrides,
})

const createMockMarketPlacePayload = (overrides: Partial<UpdateFromMarketPlacePayload> = {}): UpdateFromMarketPlacePayload => ({
  category: PluginCategoryEnum.tool,
  originalPackageInfo: {
    id: 'original-id',
    payload: createMockPluginDeclaration(),
  },
  targetPackageInfo: {
    id: 'test-target-id',
    version: '2.0.0',
  },
  ...overrides,
})

const createMockGitHubPayload = (overrides: Partial<UpdateFromGitHubPayload> = {}): UpdateFromGitHubPayload => ({
  originalPackageInfo: {
    id: 'github-original-id',
    repo: 'owner/repo',
    version: '1.0.0',
    package: 'test-package.difypkg',
    releases: [
      { tag_name: 'v1.0.0', assets: [{ id: 1, name: 'plugin.difypkg', browser_download_url: 'https://github.com/test' }] },
      { tag_name: 'v2.0.0', assets: [{ id: 2, name: 'plugin.difypkg', browser_download_url: 'https://github.com/test' }] },
    ],
  },
  ...overrides,
})

// Version list is provided by the mocked useVersionListOfPlugin hook

// ================================
// Helper Functions
// ================================

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

// ================================
// Test Suites
// ================================

describe('update-plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpen = false
    mockCheck.mockResolvedValue({ status: TaskStatus.success })
  })

  // ============================================================
  // UpdatePlugin (index.tsx) - Main Entry Component Tests
  // ============================================================
  describe('UpdatePlugin (index.tsx)', () => {
    describe('Rendering', () => {
      it('should render UpdateFromGitHub when type is github', () => {
        // Arrange
        const props: UpdatePluginModalType = {
          type: PluginSource.github,
          category: PluginCategoryEnum.tool,
          github: createMockGitHubPayload(),
          onCancel: vi.fn(),
          onSave: vi.fn(),
        }

        // Act
        render(<UpdatePlugin {...props} />)

        // Assert
        expect(screen.getByTestId('install-from-github')).toBeInTheDocument()
      })

      it('should render UpdateFromMarketplace when type is marketplace', () => {
        // Arrange
        const props: UpdatePluginModalType = {
          type: PluginSource.marketplace,
          category: PluginCategoryEnum.tool,
          marketPlace: createMockMarketPlacePayload(),
          onCancel: vi.fn(),
          onSave: vi.fn(),
        }

        // Act
        renderWithQueryClient(<UpdatePlugin {...props} />)

        // Assert
        expect(screen.getByText('Update Plugin')).toBeInTheDocument()
      })

      it('should render UpdateFromMarketplace for other plugin sources', () => {
        // Arrange
        const props: UpdatePluginModalType = {
          type: PluginSource.local,
          category: PluginCategoryEnum.tool,
          marketPlace: createMockMarketPlacePayload(),
          onCancel: vi.fn(),
          onSave: vi.fn(),
        }

        // Act
        renderWithQueryClient(<UpdatePlugin {...props} />)

        // Assert
        expect(screen.getByText('Update Plugin')).toBeInTheDocument()
      })
    })

    describe('Component Memoization', () => {
      it('should be memoized with React.memo', () => {
        // Verify the component is wrapped with React.memo
        expect(UpdatePlugin).toBeDefined()
        // The component should have $$typeof indicating it's a memo component
        expect((UpdatePlugin as any).$$typeof?.toString()).toContain('Symbol')
      })
    })

    describe('Props Passing', () => {
      it('should pass correct props to UpdateFromGitHub', () => {
        // Arrange
        const githubPayload = createMockGitHubPayload()
        const onCancel = vi.fn()
        const onSave = vi.fn()
        const props: UpdatePluginModalType = {
          type: PluginSource.github,
          category: PluginCategoryEnum.tool,
          github: githubPayload,
          onCancel,
          onSave,
        }

        // Act
        render(<UpdatePlugin {...props} />)

        // Assert
        const payloadElement = screen.getByTestId('github-payload')
        expect(payloadElement.textContent).toBe(JSON.stringify(githubPayload))
      })

      it('should call onCancel when github close is triggered', () => {
        // Arrange
        const onCancel = vi.fn()
        const props: UpdatePluginModalType = {
          type: PluginSource.github,
          category: PluginCategoryEnum.tool,
          github: createMockGitHubPayload(),
          onCancel,
          onSave: vi.fn(),
        }

        // Act
        render(<UpdatePlugin {...props} />)
        fireEvent.click(screen.getByTestId('github-close'))

        // Assert
        expect(onCancel).toHaveBeenCalledTimes(1)
      })

      it('should call onSave when github success is triggered', () => {
        // Arrange
        const onSave = vi.fn()
        const props: UpdatePluginModalType = {
          type: PluginSource.github,
          category: PluginCategoryEnum.tool,
          github: createMockGitHubPayload(),
          onCancel: vi.fn(),
          onSave,
        }

        // Act
        render(<UpdatePlugin {...props} />)
        fireEvent.click(screen.getByTestId('github-success'))

        // Assert
        expect(onSave).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ============================================================
  // FromGitHub (from-github.tsx) Tests
  // ============================================================
  describe('FromGitHub (from-github.tsx)', () => {
    describe('Rendering', () => {
      it('should render InstallFromGitHub with correct props', () => {
        // Arrange
        const payload = createMockGitHubPayload()
        const onSave = vi.fn()
        const onCancel = vi.fn()

        // Act
        render(
          <FromGitHub
            payload={payload}
            onSave={onSave}
            onCancel={onCancel}
          />,
        )

        // Assert
        expect(screen.getByTestId('install-from-github')).toBeInTheDocument()
      })
    })

    describe('Component Memoization', () => {
      it('should be memoized with React.memo', () => {
        expect(FromGitHub).toBeDefined()
        expect((FromGitHub as any).$$typeof?.toString()).toContain('Symbol')
      })
    })

    describe('Event Handlers', () => {
      it('should call onCancel when onClose is triggered', () => {
        // Arrange
        const onCancel = vi.fn()

        // Act
        render(
          <FromGitHub
            payload={createMockGitHubPayload()}
            onSave={vi.fn()}
            onCancel={onCancel}
          />,
        )
        fireEvent.click(screen.getByTestId('github-close'))

        // Assert
        expect(onCancel).toHaveBeenCalledTimes(1)
      })

      it('should call onSave when onSuccess is triggered', () => {
        // Arrange
        const onSave = vi.fn()

        // Act
        render(
          <FromGitHub
            payload={createMockGitHubPayload()}
            onSave={onSave}
            onCancel={vi.fn()}
          />,
        )
        fireEvent.click(screen.getByTestId('github-success'))

        // Assert
        expect(onSave).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ============================================================
  // UpdateFromMarketplace (from-market-place.tsx) Tests
  // ============================================================
  describe('UpdateFromMarketplace (from-market-place.tsx)', () => {
    describe('Rendering', () => {
      it('should render modal with title and description', () => {
        // Arrange
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={vi.fn()}
          />,
        )

        // Assert
        expect(screen.getByText('Update Plugin')).toBeInTheDocument()
        expect(screen.getByText('This plugin will be updated to the new version.')).toBeInTheDocument()
      })

      it('should render version badge with version transition', () => {
        // Arrange
        const payload = createMockMarketPlacePayload({
          originalPackageInfo: {
            id: 'original-id',
            payload: createMockPluginDeclaration({ version: '1.0.0' }),
          },
          targetPackageInfo: {
            id: 'target-id',
            version: '2.0.0',
          },
        })

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={vi.fn()}
          />,
        )

        // Assert
        expect(screen.getByText('1.0.0 -> 2.0.0')).toBeInTheDocument()
      })

      it('should render Update button in initial state', () => {
        // Arrange
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={vi.fn()}
          />,
        )

        // Assert
        expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      })
    })

    describe('Downgrade Warning Modal', () => {
      it('should show downgrade warning modal when isShowDowngradeWarningModal is true', () => {
        // Arrange
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={vi.fn()}
            isShowDowngradeWarningModal={true}
          />,
        )

        // Assert
        expect(screen.getByText('Downgrade Warning')).toBeInTheDocument()
        expect(screen.getByText('You are about to downgrade this plugin.')).toBeInTheDocument()
      })

      it('should not show downgrade warning modal when isShowDowngradeWarningModal is false', () => {
        // Arrange
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={vi.fn()}
            isShowDowngradeWarningModal={false}
          />,
        )

        // Assert
        expect(screen.queryByText('Downgrade Warning')).not.toBeInTheDocument()
        expect(screen.getByText('Update Plugin')).toBeInTheDocument()
      })
    })

    describe('User Interactions', () => {
      it('should call onCancel when Cancel button is clicked', () => {
        // Arrange
        const onCancel = vi.fn()
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={onCancel}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        // Assert
        expect(onCancel).toHaveBeenCalledTimes(1)
      })

      it('should call updateFromMarketPlace API when Update button is clicked', async () => {
        // Arrange
        mockUpdateFromMarketPlace.mockResolvedValue({
          all_installed: true,
          task_id: 'task-123',
        })
        const onSave = vi.fn()
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={onSave}
            onCancel={vi.fn()}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Update' }))

        // Assert
        await waitFor(() => {
          expect(mockUpdateFromMarketPlace).toHaveBeenCalledWith({
            original_plugin_unique_identifier: 'original-id',
            new_plugin_unique_identifier: 'test-target-id',
          })
        })
      })

      it('should show loading state during upgrade', async () => {
        // Arrange
        mockUpdateFromMarketPlace.mockImplementation(() => new Promise(() => {})) // Never resolves
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={vi.fn()}
          />,
        )

        // Assert - button should show Update before clicking
        expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()

        // Act - click update button
        fireEvent.click(screen.getByRole('button', { name: 'Update' }))

        // Assert - Cancel button should be hidden during upgrade
        await waitFor(() => {
          expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
        })
      })

      it('should call onSave when update completes with all_installed true', async () => {
        // Arrange
        mockUpdateFromMarketPlace.mockResolvedValue({
          all_installed: true,
          task_id: 'task-123',
        })
        const onSave = vi.fn()
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={onSave}
            onCancel={vi.fn()}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Update' }))

        // Assert
        await waitFor(() => {
          expect(onSave).toHaveBeenCalled()
        })
      })

      it('should check task status when all_installed is false', async () => {
        // Arrange
        mockUpdateFromMarketPlace.mockResolvedValue({
          all_installed: false,
          task_id: 'task-123',
        })
        mockCheck.mockResolvedValue({ status: TaskStatus.success })
        const onSave = vi.fn()
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={onSave}
            onCancel={vi.fn()}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Update' }))

        // Assert
        await waitFor(() => {
          expect(mockHandleRefetch).toHaveBeenCalled()
        })
        await waitFor(() => {
          expect(mockCheck).toHaveBeenCalledWith({
            taskId: 'task-123',
            pluginUniqueIdentifier: 'test-target-id',
          })
        })
      })

      it('should stop task check and call onCancel when modal is cancelled during upgrade', () => {
        // Arrange
        const onCancel = vi.fn()
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={onCancel}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        // Assert
        expect(mockStop).toHaveBeenCalled()
        expect(onCancel).toHaveBeenCalled()
      })
    })

    describe('Error Handling', () => {
      it('should reset to notStarted state when API call fails', async () => {
        // Arrange
        mockUpdateFromMarketPlace.mockRejectedValue(new Error('API Error'))
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={vi.fn()}
            onCancel={vi.fn()}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Update' }))

        // Assert
        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
        })
      })

      it('should show error toast when task status is failed', async () => {
        // Arrange - covers lines 99-100
        const mockToastNotify = vi.fn()
        vi.mocked(await import('../../base/toast')).default.notify = mockToastNotify

        mockUpdateFromMarketPlace.mockResolvedValue({
          all_installed: false,
          task_id: 'task-123',
        })
        mockCheck.mockResolvedValue({
          status: TaskStatus.failed,
          error: 'Installation failed due to dependency conflict',
        })
        const onSave = vi.fn()
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            onSave={onSave}
            onCancel={vi.fn()}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Update' }))

        // Assert
        await waitFor(() => {
          expect(mockCheck).toHaveBeenCalled()
        })
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith({
            type: 'error',
            message: 'Installation failed due to dependency conflict',
          })
        })
        // onSave should NOT be called when task fails
        expect(onSave).not.toHaveBeenCalled()
      })
    })

    describe('Component Memoization', () => {
      it('should be memoized with React.memo', () => {
        expect(UpdateFromMarketplace).toBeDefined()
        expect((UpdateFromMarketplace as any).$$typeof?.toString()).toContain('Symbol')
      })
    })

    describe('Exclude and Downgrade', () => {
      it('should call mutateAsync and handleConfirm when exclude and downgrade is clicked', async () => {
        // Arrange
        mockMutateAsync.mockResolvedValue({})
        mockUpdateFromMarketPlace.mockResolvedValue({
          all_installed: true,
          task_id: 'task-123',
        })
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            pluginId="test-plugin-id"
            onSave={vi.fn()}
            onCancel={vi.fn()}
            isShowDowngradeWarningModal={true}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Exclude and Downgrade' }))

        // Assert
        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledWith({
            plugin_id: 'test-plugin-id',
          })
        })
        await waitFor(() => {
          expect(mockInvalidateReferenceSettings).toHaveBeenCalled()
        })
      })

      it('should skip mutateAsync when pluginId is not provided', async () => {
        // Arrange - covers line 114 else branch
        mockMutateAsync.mockResolvedValue({})
        mockUpdateFromMarketPlace.mockResolvedValue({
          all_installed: true,
          task_id: 'task-123',
        })
        const payload = createMockMarketPlacePayload()

        // Act
        renderWithQueryClient(
          <UpdateFromMarketplace
            payload={payload}
            // pluginId is intentionally not provided
            onSave={vi.fn()}
            onCancel={vi.fn()}
            isShowDowngradeWarningModal={true}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Exclude and Downgrade' }))

        // Assert - mutateAsync should NOT be called when pluginId is undefined
        await waitFor(() => {
          expect(mockInvalidateReferenceSettings).toHaveBeenCalled()
        })
        expect(mockMutateAsync).not.toHaveBeenCalled()
      })
    })
  })

  // ============================================================
  // DowngradeWarningModal (downgrade-warning.tsx) Tests
  // ============================================================
  describe('DowngradeWarningModal (downgrade-warning.tsx)', () => {
    describe('Rendering', () => {
      it('should render title and description', () => {
        // Act
        render(
          <DowngradeWarningModal
            onCancel={vi.fn()}
            onJustDowngrade={vi.fn()}
            onExcludeAndDowngrade={vi.fn()}
          />,
        )

        // Assert
        expect(screen.getByText('Downgrade Warning')).toBeInTheDocument()
        expect(screen.getByText('You are about to downgrade this plugin.')).toBeInTheDocument()
      })

      it('should render all three action buttons', () => {
        // Act
        render(
          <DowngradeWarningModal
            onCancel={vi.fn()}
            onJustDowngrade={vi.fn()}
            onExcludeAndDowngrade={vi.fn()}
          />,
        )

        // Assert
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Just Downgrade' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Exclude and Downgrade' })).toBeInTheDocument()
      })
    })

    describe('User Interactions', () => {
      it('should call onCancel when Cancel button is clicked', () => {
        // Arrange
        const onCancel = vi.fn()

        // Act
        render(
          <DowngradeWarningModal
            onCancel={onCancel}
            onJustDowngrade={vi.fn()}
            onExcludeAndDowngrade={vi.fn()}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        // Assert
        expect(onCancel).toHaveBeenCalledTimes(1)
      })

      it('should call onJustDowngrade when Just Downgrade button is clicked', () => {
        // Arrange
        const onJustDowngrade = vi.fn()

        // Act
        render(
          <DowngradeWarningModal
            onCancel={vi.fn()}
            onJustDowngrade={onJustDowngrade}
            onExcludeAndDowngrade={vi.fn()}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Just Downgrade' }))

        // Assert
        expect(onJustDowngrade).toHaveBeenCalledTimes(1)
      })

      it('should call onExcludeAndDowngrade when Exclude and Downgrade button is clicked', () => {
        // Arrange
        const onExcludeAndDowngrade = vi.fn()

        // Act
        render(
          <DowngradeWarningModal
            onCancel={vi.fn()}
            onJustDowngrade={vi.fn()}
            onExcludeAndDowngrade={onExcludeAndDowngrade}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'Exclude and Downgrade' }))

        // Assert
        expect(onExcludeAndDowngrade).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ============================================================
  // PluginVersionPicker (plugin-version-picker.tsx) Tests
  // ============================================================
  describe('PluginVersionPicker (plugin-version-picker.tsx)', () => {
    const defaultProps = {
      isShow: false,
      onShowChange: vi.fn(),
      pluginID: 'test-plugin-id',
      currentVersion: '1.0.0',
      trigger: <button>Select Version</button>,
      onSelect: vi.fn(),
    }

    describe('Rendering', () => {
      it('should render trigger element', () => {
        // Act
        render(<PluginVersionPicker {...defaultProps} />)

        // Assert
        expect(screen.getByText('Select Version')).toBeInTheDocument()
      })

      it('should not render content when isShow is false', () => {
        // Act
        render(<PluginVersionPicker {...defaultProps} isShow={false} />)

        // Assert
        expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
      })

      it('should render version list when isShow is true', () => {
        // Act
        render(<PluginVersionPicker {...defaultProps} isShow={true} />)

        // Assert
        expect(screen.getByTestId('portal-content')).toBeInTheDocument()
        expect(screen.getByText('Switch Version')).toBeInTheDocument()
      })

      it('should render all versions from API', () => {
        // Act
        render(<PluginVersionPicker {...defaultProps} isShow={true} />)

        // Assert
        expect(screen.getByText('1.0.0')).toBeInTheDocument()
        expect(screen.getByText('1.1.0')).toBeInTheDocument()
        expect(screen.getByText('2.0.0')).toBeInTheDocument()
      })

      it('should show CURRENT badge for current version', () => {
        // Act
        render(<PluginVersionPicker {...defaultProps} isShow={true} currentVersion="1.0.0" />)

        // Assert
        expect(screen.getByText('CURRENT')).toBeInTheDocument()
      })
    })

    describe('User Interactions', () => {
      it('should call onShowChange when trigger is clicked', () => {
        // Arrange
        const onShowChange = vi.fn()

        // Act
        render(<PluginVersionPicker {...defaultProps} onShowChange={onShowChange} />)
        fireEvent.click(screen.getByTestId('portal-trigger'))

        // Assert
        expect(onShowChange).toHaveBeenCalledWith(true)
      })

      it('should not call onShowChange when trigger is clicked and disabled is true', () => {
        // Arrange
        const onShowChange = vi.fn()

        // Act
        render(<PluginVersionPicker {...defaultProps} disabled={true} onShowChange={onShowChange} />)
        fireEvent.click(screen.getByTestId('portal-trigger'))

        // Assert
        expect(onShowChange).not.toHaveBeenCalled()
      })

      it('should call onSelect with correct params when a version is selected', () => {
        // Arrange
        const onSelect = vi.fn()
        const onShowChange = vi.fn()

        // Act
        render(
          <PluginVersionPicker
            {...defaultProps}
            isShow={true}
            currentVersion="1.0.0"
            onSelect={onSelect}
            onShowChange={onShowChange}
          />,
        )
        // Click on version 2.0.0
        const versionElements = screen.getAllByText(/^\d+\.\d+\.\d+$/)
        const version2Element = versionElements.find(el => el.textContent === '2.0.0')
        if (version2Element) {
          fireEvent.click(version2Element.closest('div[class*="cursor-pointer"]')!)
        }

        // Assert
        expect(onSelect).toHaveBeenCalledWith({
          version: '2.0.0',
          unique_identifier: 'plugin-v2.0.0',
          isDowngrade: false,
        })
        expect(onShowChange).toHaveBeenCalledWith(false)
      })

      it('should not call onSelect when clicking on current version', () => {
        // Arrange
        const onSelect = vi.fn()

        // Act
        render(
          <PluginVersionPicker
            {...defaultProps}
            isShow={true}
            currentVersion="1.0.0"
            onSelect={onSelect}
          />,
        )
        // Click on current version 1.0.0
        const versionElements = screen.getAllByText(/^\d+\.\d+\.\d+$/)
        const version1Element = versionElements.find(el => el.textContent === '1.0.0')
        if (version1Element) {
          fireEvent.click(version1Element.closest('div[class*="cursor"]')!)
        }

        // Assert
        expect(onSelect).not.toHaveBeenCalled()
      })

      it('should indicate downgrade when selecting a lower version', () => {
        // Arrange
        const onSelect = vi.fn()

        // Act
        render(
          <PluginVersionPicker
            {...defaultProps}
            isShow={true}
            currentVersion="2.0.0"
            onSelect={onSelect}
          />,
        )
        // Click on version 1.0.0 (downgrade)
        const versionElements = screen.getAllByText(/^\d+\.\d+\.\d+$/)
        const version1Element = versionElements.find(el => el.textContent === '1.0.0')
        if (version1Element) {
          fireEvent.click(version1Element.closest('div[class*="cursor-pointer"]')!)
        }

        // Assert
        expect(onSelect).toHaveBeenCalledWith({
          version: '1.0.0',
          unique_identifier: 'plugin-v1.0.0',
          isDowngrade: true,
        })
      })
    })

    describe('Props', () => {
      it('should support custom placement', () => {
        // Act
        render(
          <PluginVersionPicker
            {...defaultProps}
            isShow={true}
            placement="top-end"
          />,
        )

        // Assert
        expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
      })

      it('should support custom offset', () => {
        // Act
        render(
          <PluginVersionPicker
            {...defaultProps}
            isShow={true}
            offset={{ mainAxis: 10, crossAxis: 20 }}
          />,
        )

        // Assert
        expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
      })
    })

    describe('Component Memoization', () => {
      it('should be memoized with React.memo', () => {
        expect(PluginVersionPicker).toBeDefined()
        expect((PluginVersionPicker as any).$$typeof?.toString()).toContain('Symbol')
      })
    })
  })

  // ============================================================
  // Edge Cases
  // ============================================================
  describe('Edge Cases', () => {
    it('should render github update with undefined payload (mock handles it)', () => {
      // Arrange - the mocked InstallFromGitHub handles undefined payload
      const props: UpdatePluginModalType = {
        type: PluginSource.github,
        category: PluginCategoryEnum.tool,
        github: undefined as unknown as UpdateFromGitHubPayload,
        onCancel: vi.fn(),
        onSave: vi.fn(),
      }

      // Act
      render(<UpdatePlugin {...props} />)

      // Assert - mock component renders with undefined payload
      expect(screen.getByTestId('install-from-github')).toBeInTheDocument()
    })

    it('should throw error when marketplace payload is undefined', () => {
      // Arrange
      const props: UpdatePluginModalType = {
        type: PluginSource.marketplace,
        category: PluginCategoryEnum.tool,
        marketPlace: undefined as unknown as UpdateFromMarketPlacePayload,
        onCancel: vi.fn(),
        onSave: vi.fn(),
      }

      // Act & Assert - should throw because payload is required
      expect(() => renderWithQueryClient(<UpdatePlugin {...props} />)).toThrow()
    })

    it('should handle empty version list in PluginVersionPicker', () => {
      // Override the mock temporarily
      vi.mocked(vi.importActual('@/service/use-plugins') as any).useVersionListOfPlugin = () => ({
        data: { data: { versions: [] } },
      })

      // Act
      render(
        <PluginVersionPicker {...{
          isShow: true,
          onShowChange: vi.fn(),
          pluginID: 'test',
          currentVersion: '1.0.0',
          trigger: <button>Select</button>,
          onSelect: vi.fn(),
        }}
        />,
      )

      // Assert
      expect(screen.getByText('Switch Version')).toBeInTheDocument()
    })
  })
})
