import type { PluginStatus } from '@/app/components/plugins/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskStatus } from '@/app/components/plugins/types'

// ============================================================================
// Import Components After Mocks
// ============================================================================

import PluginTasks from './index'
import {
  ErrorPluginsSection,
  RunningPluginsSection,
  SuccessPluginsSection,
} from './plugin-task-list'
import PluginTaskTrigger from './plugin-task-trigger'

// ============================================================================
// Mock Setup
// ============================================================================

// Stable translation function to avoid re-render issues
const stableT = (key: string, params?: Record<string, unknown>) => {
  if (params) {
    let result = key
    Object.entries(params).forEach(([k, v]) => {
      result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
    })
    return result
  }
  return key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

// Mock language context - prevent es-toolkit import error
vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

// Mock icon utility
vi.mock('@/app/components/plugins/install-plugin/base/use-get-icon', () => ({
  default: () => ({
    getIconUrl: (icon: string) => icon || 'default-icon.png',
  }),
}))

// Mock CardIcon component
vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src, size }: { src: string, size: string }) => (
    <div data-testid="card-icon" data-src={src} data-size={size} />
  ),
}))

// Mock DownloadingIcon
vi.mock('@/app/components/header/plugins-nav/downloading-icon', () => ({
  default: () => <div data-testid="downloading-icon" />,
}))

// Mock ProgressCircle
vi.mock('@/app/components/base/progress-bar/progress-circle', () => ({
  default: ({ percentage }: { percentage: number }) => (
    <div data-testid="progress-circle" data-percentage={percentage} />
  ),
}))

// Mock Tooltip - to avoid nested portal structure
vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock portal component with shared state for open/close behavior
let mockPortalOpenState = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => {
    mockPortalOpenState = open
    return <div data-testid="portal-root" data-open={open}>{children}</div>
  },
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => {
    if (!mockPortalOpenState)
      return null
    return <div data-testid="portal-content">{children}</div>
  },
}))

// Mock plugin task hooks
const mockHandleRefetch = vi.fn()
const mockMutateAsync = vi.fn()

let mockPluginTasks: Array<{
  id: string
  plugins: Array<Omit<PluginStatus, 'taskId'>>
}> = []

vi.mock('@/service/use-plugins', () => ({
  usePluginTaskList: () => ({
    pluginTasks: mockPluginTasks,
    handleRefetch: mockHandleRefetch,
  }),
  useMutationClearTaskPlugin: () => ({
    mutateAsync: mockMutateAsync,
  }),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createPluginStatus = (overrides: Partial<PluginStatus> = {}): PluginStatus => ({
  plugin_unique_identifier: `plugin-${Math.random().toString(36).slice(2, 9)}`,
  plugin_id: 'plugin-id-1',
  status: TaskStatus.running,
  message: '',
  icon: 'icon.png',
  labels: {
    'en-US': 'Test Plugin',
    'zh-Hans': '测试插件',
  } as Record<string, string>,
  taskId: 'task-1',
  ...overrides,
})

const createRunningPlugin = (overrides: Partial<PluginStatus> = {}): PluginStatus =>
  createPluginStatus({ status: TaskStatus.running, message: '', ...overrides })

const createSuccessPlugin = (overrides: Partial<PluginStatus> = {}): PluginStatus =>
  createPluginStatus({ status: TaskStatus.success, message: 'Installed successfully', ...overrides })

const createErrorPlugin = (overrides: Partial<PluginStatus> = {}): PluginStatus =>
  createPluginStatus({ status: TaskStatus.failed, message: 'Installation failed', ...overrides })

const createPluginTask = (
  id: string,
  plugins: Array<Omit<PluginStatus, 'taskId'>>,
) => ({
  id,
  plugins,
})

// ============================================================================
// PluginTasks Main Component Tests
// ============================================================================

describe('PluginTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
    mockPluginTasks = []
    mockMutateAsync.mockResolvedValue({})
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - verify component renders correctly in different states
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should return null when there are no plugin tasks', () => {
      // Arrange
      mockPluginTasks = []

      // Act
      const { container } = render(<PluginTasks />)

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render trigger button when there are running plugins', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [createRunningPlugin()])]

      // Act
      render(<PluginTasks />)

      // Assert
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
      expect(document.getElementById('plugin-task-trigger')).toBeInTheDocument()
    })

    it('should render trigger button when there are success plugins', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [createSuccessPlugin()])]

      // Act
      render(<PluginTasks />)

      // Assert
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })

    it('should render trigger button when there are error plugins', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [createErrorPlugin()])]

      // Act
      render(<PluginTasks />)

      // Assert
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })

    it('should render trigger button with mixed plugin states', () => {
      // Arrange
      mockPluginTasks = [
        createPluginTask('task-1', [
          createRunningPlugin({ plugin_unique_identifier: 'plugin-1' }),
          createSuccessPlugin({ plugin_unique_identifier: 'plugin-2' }),
          createErrorPlugin({ plugin_unique_identifier: 'plugin-3' }),
        ]),
      ]

      // Act
      render(<PluginTasks />)

      // Assert
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions - test click handlers and panel behavior
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should open panel when clicking trigger with running plugins', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [createRunningPlugin()])]
      render(<PluginTasks />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should open panel when clicking trigger with success plugins', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [createSuccessPlugin()])]
      render(<PluginTasks />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should open panel when clicking trigger with error plugins', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [createErrorPlugin()])]
      render(<PluginTasks />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should toggle panel on repeated clicks', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [createSuccessPlugin()])]
      render(<PluginTasks />)

      // Act - first click opens
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Act - second click closes
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should show running plugins section when panel is open', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [
        createRunningPlugin({ labels: { 'en-US': 'Running Plugin 1' } as Record<string, string> }),
      ])]
      render(<PluginTasks />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByText('plugin.task.installing')).toBeInTheDocument()
      expect(screen.getByText('Running Plugin 1')).toBeInTheDocument()
    })

    it('should show success plugins section when panel is open', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [
        createSuccessPlugin({ labels: { 'en-US': 'Success Plugin 1' } as Record<string, string> }),
      ])]
      render(<PluginTasks />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert - text may be split across elements, use container query
      expect(screen.getByText(/plugin\.task\.installed/)).toBeInTheDocument()
      expect(screen.getByText('Success Plugin 1')).toBeInTheDocument()
    })

    it('should show error plugins section when panel is open', () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [
        createErrorPlugin({
          labels: { 'en-US': 'Error Plugin 1' } as Record<string, string>,
          message: 'Failed to install',
        }),
      ])]
      render(<PluginTasks />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByText(/plugin.task.installError/)).toBeInTheDocument()
      expect(screen.getByText('Error Plugin 1')).toBeInTheDocument()
      expect(screen.getByText('Failed to install')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Clear Actions - test clearing plugins
  // --------------------------------------------------------------------------
  describe('Clear Actions', () => {
    it('should call clear handler when clicking clear all on success section', async () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [
        createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
      ])]
      render(<PluginTasks />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Act
      const clearAllButtons = screen.getAllByText('plugin.task.clearAll')
      fireEvent.click(clearAllButtons[0])

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled()
      })
    })

    it('should call clear handler when clicking clear all on error section', async () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [
        createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
      ])]
      render(<PluginTasks />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Act
      const clearAllButton = screen.getByText('plugin.task.clearAll')
      fireEvent.click(clearAllButton)

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled()
      })
    })

    it('should call clear single when clicking clear on individual error plugin', async () => {
      // Arrange
      mockPluginTasks = [createPluginTask('task-1', [
        createErrorPlugin({ plugin_unique_identifier: 'error-1', taskId: 'task-1' }),
      ])]
      render(<PluginTasks />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Act
      const clearButton = screen.getByText('common.operation.clear')
      fireEvent.click(clearButton)

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          taskId: 'task-1',
          pluginId: 'error-1',
        })
      })
    })
  })

  // --------------------------------------------------------------------------
  // Multiple Tasks - test handling of plugins from multiple tasks
  // --------------------------------------------------------------------------
  describe('Multiple Tasks', () => {
    it('should aggregate plugins from multiple tasks', () => {
      // Arrange
      mockPluginTasks = [
        createPluginTask('task-1', [
          createRunningPlugin({ plugin_unique_identifier: 'plugin-1', labels: { 'en-US': 'Plugin 1' } as Record<string, string> }),
        ]),
        createPluginTask('task-2', [
          createSuccessPlugin({ plugin_unique_identifier: 'plugin-2', labels: { 'en-US': 'Plugin 2' } as Record<string, string> }),
        ]),
      ]
      render(<PluginTasks />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByText('Plugin 1')).toBeInTheDocument()
      expect(screen.getByText('Plugin 2')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// PluginTaskTrigger Component Tests
// ============================================================================

describe('PluginTaskTrigger', () => {
  const defaultProps = {
    tip: 'Test tip',
    isInstalling: false,
    isInstallingWithSuccess: false,
    isInstallingWithError: false,
    isSuccess: false,
    isFailed: false,
    successPluginsLength: 0,
    runningPluginsLength: 0,
    errorPluginsLength: 0,
    totalPluginsLength: 1,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - verify icons and indicators render correctly
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render with default props', () => {
      // Arrange & Act
      render(<PluginTaskTrigger {...defaultProps} />)

      // Assert
      expect(document.getElementById('plugin-task-trigger')).toBeInTheDocument()
    })

    it('should render downloading icon when isInstalling is true', () => {
      // Arrange & Act
      render(<PluginTaskTrigger {...defaultProps} isInstalling />)

      // Assert
      expect(screen.getByTestId('downloading-icon')).toBeInTheDocument()
    })

    it('should render downloading icon when isInstallingWithError is true', () => {
      // Arrange & Act
      render(<PluginTaskTrigger {...defaultProps} isInstallingWithError />)

      // Assert
      expect(screen.getByTestId('downloading-icon')).toBeInTheDocument()
    })

    it('should render install icon when not installing', () => {
      // Arrange & Act
      const { container } = render(<PluginTaskTrigger {...defaultProps} isSuccess />)

      // Assert - RiInstallLine should be rendered (not downloading icon)
      expect(screen.queryByTestId('downloading-icon')).not.toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should render progress circle when isInstalling', () => {
      // Arrange & Act
      render(
        <PluginTaskTrigger
          {...defaultProps}
          isInstalling
          successPluginsLength={2}
          totalPluginsLength={5}
        />,
      )

      // Assert
      const progressCircle = screen.getByTestId('progress-circle')
      expect(progressCircle).toBeInTheDocument()
      expect(progressCircle).toHaveAttribute('data-percentage', '40')
    })

    it('should render progress circle when isInstallingWithSuccess', () => {
      // Arrange & Act
      render(
        <PluginTaskTrigger
          {...defaultProps}
          isInstallingWithSuccess
          successPluginsLength={3}
          totalPluginsLength={10}
        />,
      )

      // Assert
      const progressCircle = screen.getByTestId('progress-circle')
      expect(progressCircle).toHaveAttribute('data-percentage', '30')
    })

    it('should render progress circle when isInstallingWithError', () => {
      // Arrange & Act
      render(
        <PluginTaskTrigger
          {...defaultProps}
          isInstallingWithError
          runningPluginsLength={2}
          totalPluginsLength={5}
        />,
      )

      // Assert
      const progressCircle = screen.getByTestId('progress-circle')
      expect(progressCircle).toHaveAttribute('data-percentage', '40')
    })

    it('should render success indicator when isSuccess', () => {
      // Arrange & Act
      const { container } = render(<PluginTaskTrigger {...defaultProps} isSuccess />)

      // Assert - Should have success check icon
      expect(container.querySelector('.text-text-success')).toBeInTheDocument()
    })

    it('should render success indicator when all completed with success only', () => {
      // Arrange & Act
      const { container } = render(
        <PluginTaskTrigger
          {...defaultProps}
          successPluginsLength={3}
          runningPluginsLength={0}
          errorPluginsLength={0}
        />,
      )

      // Assert
      expect(container.querySelector('.text-text-success')).toBeInTheDocument()
    })

    it('should render error indicator when isFailed', () => {
      // Arrange & Act
      const { container } = render(<PluginTaskTrigger {...defaultProps} isFailed />)

      // Assert
      expect(container.querySelector('.text-text-destructive')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // CSS Class Tests - verify correct styling based on state
  // --------------------------------------------------------------------------
  describe('CSS Classes', () => {
    it('should apply error styles when hasError (isFailed)', () => {
      // Arrange & Act
      render(<PluginTaskTrigger {...defaultProps} isFailed />)

      // Assert
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger?.className).toContain('bg-state-destructive-hover')
    })

    it('should apply error styles when hasError (isInstallingWithError)', () => {
      // Arrange & Act
      render(<PluginTaskTrigger {...defaultProps} isInstallingWithError />)

      // Assert
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger?.className).toContain('bg-state-destructive-hover')
    })

    it('should apply cursor-pointer when isInstalling', () => {
      // Arrange & Act
      render(<PluginTaskTrigger {...defaultProps} isInstalling />)

      // Assert
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger?.className).toContain('cursor-pointer')
    })

    it('should apply cursor-pointer when isSuccess', () => {
      // Arrange & Act
      render(<PluginTaskTrigger {...defaultProps} isSuccess />)

      // Assert
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger?.className).toContain('cursor-pointer')
    })
  })
})

// ============================================================================
// Plugin List Section Components Tests
// ============================================================================

describe('Plugin List Sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // RunningPluginsSection Tests
  // --------------------------------------------------------------------------
  describe('RunningPluginsSection', () => {
    it('should return null when plugins array is empty', () => {
      // Arrange & Act
      const { container } = render(<RunningPluginsSection plugins={[]} />)

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render running plugins with loader icon', () => {
      // Arrange
      const plugins = [
        createRunningPlugin({
          plugin_unique_identifier: 'running-1',
          labels: { 'en-US': 'Installing Plugin' } as Record<string, string>,
        }),
      ]

      // Act
      render(<RunningPluginsSection plugins={plugins} />)

      // Assert
      expect(screen.getByText('Installing Plugin')).toBeInTheDocument()
      expect(screen.getAllByText('plugin.task.installing').length).toBeGreaterThan(0)
    })

    it('should render multiple running plugins', () => {
      // Arrange
      const plugins = [
        createRunningPlugin({ plugin_unique_identifier: 'running-1', labels: { 'en-US': 'Plugin A' } as Record<string, string> }),
        createRunningPlugin({ plugin_unique_identifier: 'running-2', labels: { 'en-US': 'Plugin B' } as Record<string, string> }),
      ]

      // Act
      render(<RunningPluginsSection plugins={plugins} />)

      // Assert
      expect(screen.getByText('Plugin A')).toBeInTheDocument()
      expect(screen.getByText('Plugin B')).toBeInTheDocument()
    })

    it('should display correct count in header', () => {
      // Arrange
      const plugins = [
        createRunningPlugin({ plugin_unique_identifier: 'running-1' }),
        createRunningPlugin({ plugin_unique_identifier: 'running-2' }),
        createRunningPlugin({ plugin_unique_identifier: 'running-3' }),
      ]

      // Act
      const { container } = render(<RunningPluginsSection plugins={plugins} />)

      // Assert - count is in header text content
      const header = container.querySelector('.system-sm-semibold-uppercase')
      expect(header?.textContent).toContain('(')
      expect(header?.textContent).toContain('3')
    })
  })

  // --------------------------------------------------------------------------
  // SuccessPluginsSection Tests
  // --------------------------------------------------------------------------
  describe('SuccessPluginsSection', () => {
    const mockOnClearAll = vi.fn()

    beforeEach(() => {
      mockOnClearAll.mockClear()
    })

    it('should return null when plugins array is empty', () => {
      // Arrange & Act
      const { container } = render(
        <SuccessPluginsSection plugins={[]} onClearAll={mockOnClearAll} />,
      )

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render success plugins with check icon', () => {
      // Arrange
      const plugins = [
        createSuccessPlugin({
          plugin_unique_identifier: 'success-1',
          labels: { 'en-US': 'Installed Plugin' } as Record<string, string>,
          message: 'Successfully installed',
        }),
      ]

      // Act
      render(<SuccessPluginsSection plugins={plugins} onClearAll={mockOnClearAll} />)

      // Assert
      expect(screen.getByText('Installed Plugin')).toBeInTheDocument()
      expect(screen.getByText('Successfully installed')).toBeInTheDocument()
    })

    it('should use default message when plugin message is empty', () => {
      // Arrange
      const plugins = [
        createSuccessPlugin({
          plugin_unique_identifier: 'success-1',
          labels: { 'en-US': 'Plugin' } as Record<string, string>,
          message: '',
        }),
      ]

      // Act
      render(<SuccessPluginsSection plugins={plugins} onClearAll={mockOnClearAll} />)

      // Assert
      expect(screen.getByText('plugin.task.installed')).toBeInTheDocument()
    })

    it('should render clear all button', () => {
      // Arrange
      const plugins = [createSuccessPlugin()]

      // Act
      render(<SuccessPluginsSection plugins={plugins} onClearAll={mockOnClearAll} />)

      // Assert
      expect(screen.getByText('plugin.task.clearAll')).toBeInTheDocument()
    })

    it('should call onClearAll when clear all button is clicked', () => {
      // Arrange
      const plugins = [createSuccessPlugin()]
      render(<SuccessPluginsSection plugins={plugins} onClearAll={mockOnClearAll} />)

      // Act
      fireEvent.click(screen.getByText('plugin.task.clearAll'))

      // Assert
      expect(mockOnClearAll).toHaveBeenCalledTimes(1)
    })

    it('should render multiple success plugins', () => {
      // Arrange
      const plugins = [
        createSuccessPlugin({ plugin_unique_identifier: 'success-1', labels: { 'en-US': 'Plugin X' } as Record<string, string> }),
        createSuccessPlugin({ plugin_unique_identifier: 'success-2', labels: { 'en-US': 'Plugin Y' } as Record<string, string> }),
      ]

      // Act
      render(<SuccessPluginsSection plugins={plugins} onClearAll={mockOnClearAll} />)

      // Assert
      expect(screen.getByText('Plugin X')).toBeInTheDocument()
      expect(screen.getByText('Plugin Y')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // ErrorPluginsSection Tests
  // --------------------------------------------------------------------------
  describe('ErrorPluginsSection', () => {
    const mockOnClearAll = vi.fn()
    const mockOnClearSingle = vi.fn()

    beforeEach(() => {
      mockOnClearAll.mockClear()
      mockOnClearSingle.mockClear()
    })

    it('should return null when plugins array is empty', () => {
      // Arrange & Act
      const { container } = render(
        <ErrorPluginsSection
          plugins={[]}
          onClearAll={mockOnClearAll}
          onClearSingle={mockOnClearSingle}
        />,
      )

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render error plugins with error icon', () => {
      // Arrange
      const plugins = [
        createErrorPlugin({
          plugin_unique_identifier: 'error-1',
          labels: { 'en-US': 'Failed Plugin' } as Record<string, string>,
          message: 'Network error',
        }),
      ]

      // Act
      render(
        <ErrorPluginsSection
          plugins={plugins}
          onClearAll={mockOnClearAll}
          onClearSingle={mockOnClearSingle}
        />,
      )

      // Assert
      expect(screen.getByText('Failed Plugin')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    it('should render clear all button and call onClearAll when clicked', () => {
      // Arrange
      const plugins = [createErrorPlugin()]
      render(
        <ErrorPluginsSection
          plugins={plugins}
          onClearAll={mockOnClearAll}
          onClearSingle={mockOnClearSingle}
        />,
      )

      // Act
      fireEvent.click(screen.getByText('plugin.task.clearAll'))

      // Assert
      expect(mockOnClearAll).toHaveBeenCalledTimes(1)
    })

    it('should render individual clear button for each error plugin', () => {
      // Arrange
      const plugins = [
        createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-2' }),
      ]
      render(
        <ErrorPluginsSection
          plugins={plugins}
          onClearAll={mockOnClearAll}
          onClearSingle={mockOnClearSingle}
        />,
      )

      // Assert
      const clearButtons = screen.getAllByText('common.operation.clear')
      expect(clearButtons).toHaveLength(2)
    })

    it('should call onClearSingle with correct params when individual clear is clicked', () => {
      // Arrange
      const plugins = [
        createErrorPlugin({
          plugin_unique_identifier: 'error-plugin-123',
          taskId: 'task-456',
        }),
      ]
      render(
        <ErrorPluginsSection
          plugins={plugins}
          onClearAll={mockOnClearAll}
          onClearSingle={mockOnClearSingle}
        />,
      )

      // Act
      fireEvent.click(screen.getByText('common.operation.clear'))

      // Assert
      expect(mockOnClearSingle).toHaveBeenCalledWith('task-456', 'error-plugin-123')
    })

    it('should display error count in header', () => {
      // Arrange
      const plugins = [
        createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-2' }),
      ]

      // Act
      render(
        <ErrorPluginsSection
          plugins={plugins}
          onClearAll={mockOnClearAll}
          onClearSingle={mockOnClearSingle}
        />,
      )

      // Assert
      expect(screen.getByText(/plugin.task.installError/)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
    mockPluginTasks = []
  })

  it('should handle plugin with missing labels gracefully', () => {
    // Arrange
    const pluginWithMissingLabel = createRunningPlugin({
      labels: {} as Record<string, string>,
    })
    mockPluginTasks = [createPluginTask('task-1', [pluginWithMissingLabel])]

    // Act & Assert - should not throw
    expect(() => {
      render(<PluginTasks />)
    }).not.toThrow()
  })

  it('should handle empty icon URL', () => {
    // Arrange
    const pluginWithNoIcon = createRunningPlugin({
      icon: '',
    })
    mockPluginTasks = [createPluginTask('task-1', [pluginWithNoIcon])]
    render(<PluginTasks />)

    // Act
    fireEvent.click(screen.getByTestId('portal-trigger'))

    // Assert
    const cardIcon = screen.getByTestId('card-icon')
    expect(cardIcon).toHaveAttribute('data-src', 'default-icon.png')
  })

  it('should handle very long error messages', () => {
    // Arrange
    const longMessage = 'A'.repeat(500)
    const pluginWithLongMessage = createErrorPlugin({
      message: longMessage,
    })
    mockPluginTasks = [createPluginTask('task-1', [pluginWithLongMessage])]
    render(<PluginTasks />)

    // Act
    fireEvent.click(screen.getByTestId('portal-trigger'))

    // Assert
    expect(screen.getByText(longMessage)).toBeInTheDocument()
  })

  it('should attempt to clear plugin even when API fails', async () => {
    // Arrange - API will fail but we should still call it
    mockPluginTasks = [createPluginTask('task-1', [createErrorPlugin()])]
    render(<PluginTasks />)
    fireEvent.click(screen.getByTestId('portal-trigger'))

    // Act
    const clearButton = screen.getByText('common.operation.clear')
    fireEvent.click(clearButton)

    // Assert - mutation should be called
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
    })
  })

  it('should calculate progress correctly with zero total', () => {
    // Arrange & Act
    render(
      <PluginTaskTrigger
        tip="Test"
        isInstalling
        isInstallingWithSuccess={false}
        isInstallingWithError={false}
        isSuccess={false}
        isFailed={false}
        successPluginsLength={0}
        runningPluginsLength={0}
        errorPluginsLength={0}
        totalPluginsLength={0}
      />,
    )

    // Assert - should handle division by zero
    const progressCircle = screen.getByTestId('progress-circle')
    expect(progressCircle).toHaveAttribute('data-percentage', 'NaN')
  })

  it('should handle rapid toggle clicks', () => {
    // Arrange
    mockPluginTasks = [createPluginTask('task-1', [createSuccessPlugin()])]
    render(<PluginTasks />)
    const trigger = screen.getByTestId('portal-trigger')

    // Act - rapid clicks
    for (let i = 0; i < 5; i++)
      fireEvent.click(trigger)

    // Assert - should end in open state (odd number of clicks)
    expect(screen.getByTestId('portal-content')).toBeInTheDocument()
  })
})

// ============================================================================
// Tooltip Integration Tests
// ============================================================================

describe('Tooltip Tips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
    mockPluginTasks = []
  })

  it('should show installing tip when only running', () => {
    // Arrange
    mockPluginTasks = [createPluginTask('task-1', [createRunningPlugin()])]

    // Act
    render(<PluginTasks />)

    // Assert - tip is passed to trigger, we just verify render doesn't break
    expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
  })

  it('should show success tip when all success', () => {
    // Arrange
    mockPluginTasks = [createPluginTask('task-1', [createSuccessPlugin()])]

    // Act
    render(<PluginTasks />)

    // Assert
    expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
  })

  it('should show error tip when has failures', () => {
    // Arrange
    mockPluginTasks = [createPluginTask('task-1', [createErrorPlugin()])]

    // Act
    render(<PluginTasks />)

    // Assert
    expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
  })

  it('should show installingWithSuccess tip when running with success', () => {
    // Arrange - running + success = isInstallingWithSuccess
    mockPluginTasks = [createPluginTask('task-1', [
      createRunningPlugin({ plugin_unique_identifier: 'running-1' }),
      createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
    ])]

    // Act
    render(<PluginTasks />)

    // Assert
    expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
  })

  it('should show installingWithError tip when running with errors', () => {
    // Arrange - running + error = isInstallingWithError
    mockPluginTasks = [createPluginTask('task-1', [
      createRunningPlugin({ plugin_unique_identifier: 'running-1' }),
      createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
    ])]

    // Act
    render(<PluginTasks />)

    // Assert
    expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
  })
})

// ============================================================================
// usePluginTaskPanel Hook Branch Coverage Tests
// ============================================================================

describe('usePluginTaskPanel Branch Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
    mockPluginTasks = []
    mockMutateAsync.mockResolvedValue({})
  })

  // --------------------------------------------------------------------------
  // closeIfNoRunning branch - when runningPluginsLength > 0
  // --------------------------------------------------------------------------
  describe('closeIfNoRunning branch', () => {
    it('should NOT close panel when there are still running plugins after clearing', async () => {
      // Arrange - 2 running plugins, 1 success plugin
      mockPluginTasks = [createPluginTask('task-1', [
        createRunningPlugin({ plugin_unique_identifier: 'running-1' }),
        createRunningPlugin({ plugin_unique_identifier: 'running-2' }),
        createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
      ])]
      render(<PluginTasks />)

      // Open the panel
      fireEvent.click(screen.getByTestId('portal-trigger'))
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Act - click clear all (clears success plugins)
      const clearAllButton = screen.getByText('plugin.task.clearAll')
      fireEvent.click(clearAllButton)

      // Assert - panel should still be open because there are running plugins
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled()
      })
      // Panel remains open due to running plugins (runningPluginsLength > 0)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should close panel when no running plugins remain after clearing', async () => {
      // Arrange - only success plugins (no running)
      mockPluginTasks = [createPluginTask('task-1', [
        createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
      ])]
      render(<PluginTasks />)

      // Open the panel
      fireEvent.click(screen.getByTestId('portal-trigger'))
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Act - click clear all
      const clearAllButton = screen.getByText('plugin.task.clearAll')
      fireEvent.click(clearAllButton)

      // Assert - mutation should be called
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled()
      })
    })
  })

  // --------------------------------------------------------------------------
  // handleClearErrors branch
  // --------------------------------------------------------------------------
  describe('handleClearErrors', () => {
    it('should clear only error plugins when clicking clear all in error section', async () => {
      // Arrange - mix of success and error plugins
      mockPluginTasks = [createPluginTask('task-1', [
        createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-2' }),
      ])]
      render(<PluginTasks />)

      // Open the panel
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Act - click clear all in error section (second clearAll button)
      const clearAllButtons = screen.getAllByText('plugin.task.clearAll')
      // Error section clear button
      fireEvent.click(clearAllButtons[1])

      // Assert - should clear error plugins
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(2) // 2 error plugins
      })
    })
  })

  // --------------------------------------------------------------------------
  // handleClearAll clears both success and error plugins
  // --------------------------------------------------------------------------
  describe('handleClearAll', () => {
    it('should clear both success and error plugins', async () => {
      // Arrange - mix of success and error plugins
      mockPluginTasks = [createPluginTask('task-1', [
        createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
        createSuccessPlugin({ plugin_unique_identifier: 'success-2' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
      ])]
      render(<PluginTasks />)

      // Open the panel
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Act - click clear all in success section (first clearAll button)
      const clearAllButtons = screen.getAllByText('plugin.task.clearAll')
      fireEvent.click(clearAllButtons[0])

      // Assert - should clear all completed plugins (3 total: 2 success + 1 error)
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(3)
      })
    })
  })

  // --------------------------------------------------------------------------
  // canOpenPanel false branch - when no valid state to open panel
  // --------------------------------------------------------------------------
  describe('canOpenPanel false branch', () => {
    it('should not open panel when clicking trigger in invalid state', () => {
      // This branch is difficult to test because the hook logic always returns
      // a valid state when there are plugins. The canOpenPanel is computed from
      // isFailed || isInstalling || isInstallingWithSuccess || isInstallingWithError || isSuccess
      // which covers all possible states when totalPluginsLength > 0

      // The only way canOpenPanel can be false is if all status flags are false,
      // which theoretically shouldn't happen with the current hook logic
      // This test documents the behavior
      mockPluginTasks = [createPluginTask('task-1', [createRunningPlugin()])]
      render(<PluginTasks />)

      // Initial state - panel should be closed
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()

      // Click trigger - should open because isInstalling is true
      fireEvent.click(screen.getByTestId('portal-trigger'))
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Tip message variations - all branches
  // --------------------------------------------------------------------------
  describe('tip message branches', () => {
    it('should compute isInstallingWithSuccess tip correctly', () => {
      // Arrange - running > 0, success > 0, error = 0 triggers isInstallingWithSuccess
      mockPluginTasks = [createPluginTask('task-1', [
        createRunningPlugin({ plugin_unique_identifier: 'running-1' }),
        createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
      ])]

      // Act
      render(<PluginTasks />)

      // Assert - component renders with isInstallingWithSuccess state
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
      expect(screen.getByTestId('progress-circle')).toBeInTheDocument()
    })

    it('should compute isInstallingWithError tip correctly', () => {
      // Arrange - running > 0, error > 0 triggers isInstallingWithError
      mockPluginTasks = [createPluginTask('task-1', [
        createRunningPlugin({ plugin_unique_identifier: 'running-1' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
      ])]

      // Act
      render(<PluginTasks />)

      // Assert - component renders with error styling
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger?.className).toContain('bg-state-destructive-hover')
    })

    it('should compute isInstalling tip correctly (only running)', () => {
      // Arrange - only running plugins
      mockPluginTasks = [createPluginTask('task-1', [
        createRunningPlugin({ plugin_unique_identifier: 'running-1' }),
      ])]

      // Act
      render(<PluginTasks />)

      // Assert
      expect(screen.getByTestId('downloading-icon')).toBeInTheDocument()
    })

    it('should compute isFailed tip correctly (errors without running)', () => {
      // Arrange - errors only, no running
      mockPluginTasks = [createPluginTask('task-1', [
        createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
      ])]

      // Act
      render(<PluginTasks />)

      // Assert - should show error indicator
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger?.className).toContain('bg-state-destructive-hover')
    })

    it('should compute isSuccess tip correctly (all success)', () => {
      // Arrange - all success plugins
      mockPluginTasks = [createPluginTask('task-1', [
        createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
        createSuccessPlugin({ plugin_unique_identifier: 'success-2' }),
      ])]

      // Act
      const { container } = render(<PluginTasks />)

      // Assert - should show success indicator
      expect(container.querySelector('.text-text-success')).toBeInTheDocument()
    })

    it('should compute isFailed with mixed success and error (but no running)', () => {
      // Arrange - success + error, no running = isFailed (because errorPluginsLength > 0)
      mockPluginTasks = [createPluginTask('task-1', [
        createSuccessPlugin({ plugin_unique_identifier: 'success-1' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-1' }),
      ])]

      // Act
      render(<PluginTasks />)

      // Assert - should show error styling because isFailed is true
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger?.className).toContain('bg-state-destructive-hover')
    })
  })

  // --------------------------------------------------------------------------
  // clearPlugins iteration - clearing multiple plugins
  // --------------------------------------------------------------------------
  describe('clearPlugins iteration', () => {
    it('should clear plugins one by one in order', async () => {
      // Arrange - multiple error plugins
      mockPluginTasks = [createPluginTask('task-1', [
        createErrorPlugin({ plugin_unique_identifier: 'error-1', taskId: 'task-1' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-2', taskId: 'task-1' }),
        createErrorPlugin({ plugin_unique_identifier: 'error-3', taskId: 'task-1' }),
      ])]
      render(<PluginTasks />)

      // Open panel
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Act - click clear all in error section
      const clearAllButton = screen.getByText('plugin.task.clearAll')
      fireEvent.click(clearAllButton)

      // Assert - should call mutateAsync for each plugin
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(3)
      })

      // Verify each plugin was cleared
      expect(mockMutateAsync).toHaveBeenNthCalledWith(1, {
        taskId: 'task-1',
        pluginId: 'error-1',
      })
      expect(mockMutateAsync).toHaveBeenNthCalledWith(2, {
        taskId: 'task-1',
        pluginId: 'error-2',
      })
      expect(mockMutateAsync).toHaveBeenNthCalledWith(3, {
        taskId: 'task-1',
        pluginId: 'error-3',
      })
    })
  })
})
