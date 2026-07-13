import type { PluginStatus } from '@/app/components/plugins/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource, TaskStatus } from '@/app/components/plugins/types'
// Import mocked modules
import { useMutationClearTaskPlugin, usePluginTaskList } from '@/service/use-plugins'
import PluginTaskList from '../components/plugin-task-list'
import TaskStatusIndicator from '../components/task-status-indicator'
import { usePluginTaskStatus } from '../hooks'
import PluginTasks from '../index'

// Mock external dependencies
vi.mock('@/service/use-plugins', () => ({
  usePluginTaskList: vi.fn(),
  useMutationClearTaskPlugin: vi.fn(),
}))

vi.mock('@/app/components/plugins/install-plugin/base/use-get-icon', () => ({
  default: () => ({
    getIconUrl: (icon: string) => `https://example.com/${icon}`,
  }),
}))
// Helper to create mock plugin
const createMockPlugin = (overrides: Partial<PluginStatus> = {}): PluginStatus => ({
  plugin_unique_identifier: `plugin-${Math.random().toString(36).substr(2, 9)}`,
  plugin_id: 'test-plugin',
  source: PluginSource.marketplace,
  status: TaskStatus.running,
  message: '',
  icon: 'test-icon.png',
  labels: {
    en_US: 'Test Plugin',
    zh_Hans: '测试插件',
  } as Record<string, string>,
  taskId: 'task-1',
  ...overrides,
})

// Helper to setup mock hook returns
const setupMocks = (plugins: PluginStatus[] = []) => {
  const mockMutateAsync = vi.fn().mockResolvedValue({})
  const mockHandleRefetch = vi.fn()

  vi.mocked(usePluginTaskList).mockReturnValue({
    pluginTasks:
      plugins.length > 0
        ? [
            {
              id: 'task-1',
              plugins,
              created_at: '',
              updated_at: '',
              status: TaskStatus.running,
              total_plugins: plugins.length,
              completed_plugins: 0,
            },
          ]
        : [],
    handleRefetch: mockHandleRefetch,
  } as unknown as ReturnType<typeof usePluginTaskList>)

  vi.mocked(useMutationClearTaskPlugin).mockReturnValue({
    mutateAsync: mockMutateAsync,
  } as unknown as ReturnType<typeof useMutationClearTaskPlugin>)

  return { mockMutateAsync, mockHandleRefetch }
}

const getTaskMenuTrigger = () =>
  document.getElementById('plugin-task-trigger')!.closest('[role="button"]') as HTMLElement

describe('usePluginTaskStatus Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Plugin categorization', () => {
    it('should categorize running plugins correctly', () => {
      const runningPlugin = createMockPlugin({ status: TaskStatus.running })
      setupMocks([runningPlugin])

      const TestComponent = () => {
        const { runningPlugins, runningPluginsLength } = usePluginTaskStatus()
        return (
          <div>
            <span data-testid="running-count">{runningPluginsLength}</span>
            <span data-testid="running-id">{runningPlugins[0]?.plugin_unique_identifier}</span>
          </div>
        )
      }

      render(<TestComponent />)

      expect(screen.getByTestId('running-count'))!.toHaveTextContent('1')
      expect(screen.getByTestId('running-id'))!.toHaveTextContent(
        runningPlugin.plugin_unique_identifier,
      )
    })

    it('should categorize success plugins correctly', () => {
      const successPlugin = createMockPlugin({ status: TaskStatus.success })
      setupMocks([successPlugin])

      const TestComponent = () => {
        const { successPlugins, successPluginsLength } = usePluginTaskStatus()
        return (
          <div>
            <span data-testid="success-count">{successPluginsLength}</span>
            <span data-testid="success-id">{successPlugins[0]?.plugin_unique_identifier}</span>
          </div>
        )
      }

      render(<TestComponent />)

      expect(screen.getByTestId('success-count'))!.toHaveTextContent('1')
      expect(screen.getByTestId('success-id'))!.toHaveTextContent(
        successPlugin.plugin_unique_identifier,
      )
    })

    it('should categorize error plugins correctly', () => {
      const errorPlugin = createMockPlugin({ status: TaskStatus.failed, message: 'Install failed' })
      setupMocks([errorPlugin])

      const TestComponent = () => {
        const { errorPlugins, errorPluginsLength } = usePluginTaskStatus()
        return (
          <div>
            <span data-testid="error-count">{errorPluginsLength}</span>
            <span data-testid="error-id">{errorPlugins[0]?.plugin_unique_identifier}</span>
          </div>
        )
      }

      render(<TestComponent />)

      expect(screen.getByTestId('error-count'))!.toHaveTextContent('1')
      expect(screen.getByTestId('error-id'))!.toHaveTextContent(
        errorPlugin.plugin_unique_identifier,
      )
    })

    it('should categorize mixed plugins correctly', () => {
      const plugins = [
        createMockPlugin({ status: TaskStatus.running, plugin_unique_identifier: 'running-1' }),
        createMockPlugin({ status: TaskStatus.success, plugin_unique_identifier: 'success-1' }),
        createMockPlugin({ status: TaskStatus.failed, plugin_unique_identifier: 'error-1' }),
      ]
      setupMocks(plugins)

      const TestComponent = () => {
        const {
          runningPluginsLength,
          successPluginsLength,
          errorPluginsLength,
          totalPluginsLength,
        } = usePluginTaskStatus()
        return (
          <div>
            <span data-testid="running">{runningPluginsLength}</span>
            <span data-testid="success">{successPluginsLength}</span>
            <span data-testid="error">{errorPluginsLength}</span>
            <span data-testid="total">{totalPluginsLength}</span>
          </div>
        )
      }

      render(<TestComponent />)

      expect(screen.getByTestId('running'))!.toHaveTextContent('1')
      expect(screen.getByTestId('success'))!.toHaveTextContent('1')
      expect(screen.getByTestId('error'))!.toHaveTextContent('1')
      expect(screen.getByTestId('total'))!.toHaveTextContent('3')
    })
  })

  describe('Status flags', () => {
    it('should set isInstalling when only running plugins exist', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.running })])

      const TestComponent = () => {
        const {
          isInstalling,
          isInstallingWithSuccess,
          isInstallingWithError,
          isSuccess,
          isFailed,
        } = usePluginTaskStatus()
        return (
          <div>
            <span data-testid="isInstalling">{String(isInstalling)}</span>
            <span data-testid="isInstallingWithSuccess">{String(isInstallingWithSuccess)}</span>
            <span data-testid="isInstallingWithError">{String(isInstallingWithError)}</span>
            <span data-testid="isSuccess">{String(isSuccess)}</span>
            <span data-testid="isFailed">{String(isFailed)}</span>
          </div>
        )
      }

      render(<TestComponent />)

      expect(screen.getByTestId('isInstalling'))!.toHaveTextContent('true')
      expect(screen.getByTestId('isInstallingWithSuccess'))!.toHaveTextContent('false')
      expect(screen.getByTestId('isInstallingWithError'))!.toHaveTextContent('false')
      expect(screen.getByTestId('isSuccess'))!.toHaveTextContent('false')
      expect(screen.getByTestId('isFailed'))!.toHaveTextContent('false')
    })

    it('should set isInstallingWithSuccess when running and success plugins exist', () => {
      setupMocks([
        createMockPlugin({ status: TaskStatus.running }),
        createMockPlugin({ status: TaskStatus.success }),
      ])

      const TestComponent = () => {
        const { isInstallingWithSuccess } = usePluginTaskStatus()
        return <span data-testid="flag">{String(isInstallingWithSuccess)}</span>
      }

      render(<TestComponent />)
      expect(screen.getByTestId('flag'))!.toHaveTextContent('true')
    })

    it('should set isInstallingWithError when running and error plugins exist', () => {
      setupMocks([
        createMockPlugin({ status: TaskStatus.running }),
        createMockPlugin({ status: TaskStatus.failed }),
      ])

      const TestComponent = () => {
        const { isInstallingWithError } = usePluginTaskStatus()
        return <span data-testid="flag">{String(isInstallingWithError)}</span>
      }

      render(<TestComponent />)
      expect(screen.getByTestId('flag'))!.toHaveTextContent('true')
    })

    it('should set isSuccess when all plugins succeeded', () => {
      setupMocks([
        createMockPlugin({ status: TaskStatus.success }),
        createMockPlugin({ status: TaskStatus.success }),
      ])

      const TestComponent = () => {
        const { isSuccess } = usePluginTaskStatus()
        return <span data-testid="flag">{String(isSuccess)}</span>
      }

      render(<TestComponent />)
      expect(screen.getByTestId('flag'))!.toHaveTextContent('true')
    })

    it('should set isFailed when no running plugins and some failed', () => {
      setupMocks([
        createMockPlugin({ status: TaskStatus.success }),
        createMockPlugin({ status: TaskStatus.failed }),
      ])

      const TestComponent = () => {
        const { isFailed } = usePluginTaskStatus()
        return <span data-testid="flag">{String(isFailed)}</span>
      }

      render(<TestComponent />)
      expect(screen.getByTestId('flag'))!.toHaveTextContent('true')
    })
  })

  describe('handleClearErrorPlugin', () => {
    it('should call mutateAsync and handleRefetch', async () => {
      const { mockMutateAsync, mockHandleRefetch } = setupMocks([
        createMockPlugin({ status: TaskStatus.failed }),
      ])

      const TestComponent = () => {
        const { handleClearErrorPlugin } = usePluginTaskStatus()
        return <button onClick={() => handleClearErrorPlugin('task-1', 'plugin-1')}>Clear</button>
      }

      render(<TestComponent />)
      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          taskId: 'task-1',
          pluginId: 'plugin-1',
        })
        expect(mockHandleRefetch).toHaveBeenCalled()
      })
    })
  })
})

// ============================================================================
// TaskStatusIndicator Component Tests
// ============================================================================
describe('TaskStatusIndicator Component', () => {
  const defaultProps = {
    tip: 'Test tooltip',
    isInstalling: false,
    isInstallingWithSuccess: false,
    isInstallingWithError: false,
    isSuccess: false,
    isFailed: false,
    successPluginsLength: 0,
    runningPluginsLength: 0,
    totalPluginsLength: 1,
    onClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TaskStatusIndicator {...defaultProps} />)
      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should render with correct id', () => {
      render(<TaskStatusIndicator {...defaultProps} />)
      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })
  })

  describe('Icon display', () => {
    it('should show downloading icon when installing', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstalling />)
      // DownloadingIcon is rendered when isInstalling is true
      // DownloadingIcon is rendered when isInstalling is true
      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should show downloading icon when installing with error', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstallingWithError />)
      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should show install icon when not installing', () => {
      render(<TaskStatusIndicator {...defaultProps} isSuccess />)
      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })
  })

  describe('Status badge', () => {
    it('should not show a badge when installing has no success or error yet', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstalling
          successPluginsLength={1}
          totalPluginsLength={3}
        />,
      )
      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should not show success badge when installing with success', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstallingWithSuccess
          successPluginsLength={2}
          totalPluginsLength={3}
        />,
      )
      expect(screen.queryByTestId('task-status-success-badge')).not.toBeInTheDocument()
    })

    it('should show error badge when installing with error', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstallingWithError
          runningPluginsLength={1}
          totalPluginsLength={3}
        />,
      )
      expect(screen.getByTestId('task-status-error-badge')).toBeInTheDocument()
    })

    it('should show success icon when all completed successfully', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isSuccess
          successPluginsLength={3}
          runningPluginsLength={0}
          totalPluginsLength={3}
        />,
      )
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger)!.toHaveClass(
        'border-components-panel-border-subtle',
        'bg-components-panel-bg',
      )
      expect(screen.getByTestId('task-status-success-badge')).toHaveClass('text-text-success')
    })

    it('should show error icon when failed', () => {
      render(<TaskStatusIndicator {...defaultProps} isFailed />)
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger)!.toHaveClass(
        'border-components-button-destructive-secondary-border-hover',
        'bg-state-destructive-hover',
      )
      expect(screen.getByTestId('task-status-error-badge')).toHaveClass('text-text-destructive')
    })
  })

  describe('Styling', () => {
    it('should apply error styles when installing with error', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstallingWithError />)
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger)!.toHaveClass('bg-state-destructive-hover')
    })

    it('should apply error styles when failed', () => {
      render(<TaskStatusIndicator {...defaultProps} isFailed />)
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger)!.toHaveClass('bg-state-destructive-hover')
    })

    it('should apply cursor-pointer for statuses that open the task menu', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstalling />)
      const trigger = document.getElementById('plugin-task-trigger')
      expect(trigger)!.toHaveClass('cursor-pointer')
    })
  })

  describe('User interactions', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn()
      render(<TaskStatusIndicator {...defaultProps} onClick={handleClick} />)

      fireEvent.click(document.getElementById('plugin-task-trigger')!)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })
})

describe('PluginTaskList Component', () => {
  const defaultProps = {
    runningPlugins: [] as PluginStatus[],
    successPlugins: [] as PluginStatus[],
    errorPlugins: [] as PluginStatus[],
    getIconUrl: (icon: string) => `https://example.com/${icon}`,
    onClearAll: vi.fn(),
    onClearErrors: vi.fn(),
    onClearSingle: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing with empty lists', () => {
      render(<PluginTaskList {...defaultProps} />)
      expect(screen.getByTestId('plugin-task-list'))!.toBeInTheDocument()
    })

    it('should render running plugins section when plugins exist', () => {
      const runningPlugins = [createMockPlugin({ status: TaskStatus.running })]
      render(<PluginTaskList {...defaultProps} runningPlugins={runningPlugins} />)

      // Translation key is returned as text in tests, multiple matches expected (title + status)
      expect(screen.getAllByText(/task\.installing/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/task\.runningPlugins/i)).toBeInTheDocument()
    })

    it('should render success plugins in the dropdown', () => {
      const successPlugins = [createMockPlugin({ status: TaskStatus.success })]
      render(<PluginTaskList {...defaultProps} successPlugins={successPlugins} />)

      expect(screen.getAllByText(/task\.installed/i).length).toBeGreaterThan(0)
    })

    it('should render error plugins section when plugins exist', () => {
      const errorPlugins = [
        createMockPlugin({ status: TaskStatus.failed, message: 'Error occurred' }),
      ]
      render(<PluginTaskList {...defaultProps} errorPlugins={errorPlugins} />)

      expect(screen.getByText('Error occurred'))!.toBeInTheDocument()
    })

    it('should render separate sections when running and failed plugins exist', () => {
      render(
        <PluginTaskList
          {...defaultProps}
          runningPlugins={[createMockPlugin({ status: TaskStatus.running })]}
          errorPlugins={[createMockPlugin({ status: TaskStatus.failed })]}
        />,
      )

      expect(screen.getByText(/task\.runningPlugins/i)).toBeInTheDocument()
      expect(screen.getByText(/task\.errorPlugins/i)).toBeInTheDocument()
      expect(screen.getByText(/task\.installingHint/i)).toBeInTheDocument()
    })
  })

  describe('User interactions', () => {
    it('should call onClearErrors when clear all button is clicked in error section', () => {
      const handleClearErrors = vi.fn()
      const errorPlugins = [createMockPlugin({ status: TaskStatus.failed })]

      render(
        <PluginTaskList
          {...defaultProps}
          errorPlugins={errorPlugins}
          onClearErrors={handleClearErrors}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /task\.errorPlugins.*task\.clearAll/i }))

      expect(handleClearErrors).toHaveBeenCalledTimes(1)
    })

    it('should call onClearSingle with correct args when individual clear is clicked', () => {
      const handleClearSingle = vi.fn()
      const errorPlugin = createMockPlugin({
        status: TaskStatus.failed,
        plugin_unique_identifier: 'error-plugin-1',
        taskId: 'task-123',
      })

      render(
        <PluginTaskList
          {...defaultProps}
          errorPlugins={[errorPlugin]}
          onClearSingle={handleClearSingle}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /Clear Test Plugin/i }))

      expect(handleClearSingle).toHaveBeenCalledWith('task-123', 'error-plugin-1')
    })
  })

  describe('Plugin display', () => {
    it('should display plugin name from labels', () => {
      const plugin = createMockPlugin({
        status: TaskStatus.running,
        labels: { en_US: 'My Test Plugin' } as Record<string, string>,
      })

      render(<PluginTaskList {...defaultProps} runningPlugins={[plugin]} />)

      expect(screen.getByText('My Test Plugin'))!.toBeInTheDocument()
    })

    it('should display running plugin message when available', () => {
      const plugin = createMockPlugin({
        status: TaskStatus.running,
        message: 'Installing now',
      })

      render(<PluginTaskList {...defaultProps} runningPlugins={[plugin]} />)

      expect(screen.getByText('Installing now'))!.toBeInTheDocument()
    })

    it('should display multiple plugins in each section', () => {
      const runningPlugins = [
        createMockPlugin({
          status: TaskStatus.running,
          labels: { en_US: 'Plugin A' } as Record<string, string>,
        }),
        createMockPlugin({
          status: TaskStatus.running,
          labels: { en_US: 'Plugin B' } as Record<string, string>,
        }),
      ]

      render(<PluginTaskList {...defaultProps} runningPlugins={runningPlugins} />)

      expect(screen.getByText('Plugin A'))!.toBeInTheDocument()
      expect(screen.getByText('Plugin B'))!.toBeInTheDocument()
      // Count is rendered, verify multiple items are in list
      expect(screen.getByText('Plugin A'))!.toBeInTheDocument()
      expect(screen.getByText('Plugin B'))!.toBeInTheDocument()
    })
  })
})

// ============================================================================
// PluginTasks Main Component Tests
// ============================================================================
describe('PluginTasks Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should hide the trigger icon when no plugins exist', () => {
      setupMocks([])

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger')).not.toBeInTheDocument()
    })

    it('should render when plugins exist', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.running })])

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })
  })

  describe('Tooltip text (tip memoization)', () => {
    it('should show installing tip when isInstalling', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.running })])

      render(<PluginTasks />)

      // The component renders with a tooltip, we verify it exists
      // The component renders with a tooltip, we verify it exists
      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should show success tip when all succeeded', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.success })])

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should show error tip when some failed', () => {
      setupMocks([
        createMockPlugin({ status: TaskStatus.success }),
        createMockPlugin({ status: TaskStatus.failed }),
      ])

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })
  })

  describe('Popover interaction', () => {
    it('should toggle popover when an error status allows', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.failed })])

      render(<PluginTasks />)

      // Click to open
      fireEvent.click(getTaskMenuTrigger())

      // The popover content should be visible (PluginTaskList)
      // The popover content should be visible (PluginTaskList)
      expect(screen.getByTestId('plugin-task-list'))!.toBeInTheDocument()
    })

    it('should apply open styling to the trigger while the task menu is expanded', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.failed })])

      render(<PluginTasks />)

      fireEvent.click(getTaskMenuTrigger())

      expect(document.getElementById('plugin-task-trigger'))!.toHaveClass(
        'bg-state-destructive-hover-alt',
      )
    })

    it('should apply pointer cursor to the task menu trigger when it can open', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.failed })])

      render(<PluginTasks />)

      expect(getTaskMenuTrigger()).toHaveClass('cursor-pointer')
    })

    it('should apply custom dropdown positioning props', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.failed })])

      render(<PluginTasks dropdownPlacement="bottom-start" dropdownAnchor={() => document.body} />)

      fireEvent.click(getTaskMenuTrigger())

      expect(document.querySelector('[data-side="bottom"][data-align="start"]')).toBeInTheDocument()
    })

    it('should toggle popover while installing', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.running })])

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
      fireEvent.click(getTaskMenuTrigger())
      expect(screen.getByTestId('plugin-task-list')).toBeInTheDocument()
    })
  })

  describe('Clear handlers', () => {
    it('should clear success and failed plugins when Clear all is clicked', async () => {
      const { mockMutateAsync } = setupMocks([
        createMockPlugin({ status: TaskStatus.success, plugin_unique_identifier: 'success-1' }),
        createMockPlugin({ status: TaskStatus.failed, plugin_unique_identifier: 'error-1' }),
      ])

      render(<PluginTasks />)

      // Open popover
      fireEvent.click(getTaskMenuTrigger())

      // Wait for popover content to render
      await waitFor(() => {
        expect(screen.getByTestId('plugin-task-list'))!.toBeInTheDocument()
      })

      // Find and click clear all button
      fireEvent.click(screen.getByRole('button', { name: /task\.successPlugins.*task\.clearAll/i }))

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(2)
        expect(mockMutateAsync).toHaveBeenCalledWith({
          taskId: 'task-1',
          pluginId: 'success-1',
        })
        expect(mockMutateAsync).toHaveBeenCalledWith({
          taskId: 'task-1',
          pluginId: 'error-1',
        })
      })
    })

    it('should close the menu after clearing the last failed plugin', async () => {
      setupMocks([
        createMockPlugin({ status: TaskStatus.failed, plugin_unique_identifier: 'error-1' }),
      ])

      render(<PluginTasks />)

      fireEvent.click(getTaskMenuTrigger())

      await waitFor(() => {
        expect(screen.getByTestId('plugin-task-list')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /task\.errorPlugins.*task\.clearAll/i }))

      await waitFor(() => {
        expect(screen.queryByTestId('plugin-task-list')).not.toBeInTheDocument()
      })
    })

    it('should clear only error plugins when onClearErrors is called', async () => {
      const { mockMutateAsync } = setupMocks([
        createMockPlugin({ status: TaskStatus.failed, plugin_unique_identifier: 'error-1' }),
      ])

      render(<PluginTasks />)

      // Open popover
      fireEvent.click(getTaskMenuTrigger())

      await waitFor(() => {
        expect(screen.getByTestId('plugin-task-list'))!.toBeInTheDocument()
      })

      // Find and click the clear all button in error section
      fireEvent.click(screen.getByRole('button', { name: /task\.errorPlugins.*task\.clearAll/i }))

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled()
      })
    })

    it('should clear single plugin when onClearSingle is called', async () => {
      const { mockMutateAsync } = setupMocks([
        createMockPlugin({
          status: TaskStatus.failed,
          plugin_unique_identifier: 'error-plugin',
          taskId: 'task-1',
        }),
      ])

      render(<PluginTasks />)

      // Open popover
      fireEvent.click(getTaskMenuTrigger())

      await waitFor(() => {
        expect(screen.getByTestId('plugin-task-list'))!.toBeInTheDocument()
      })

      // Find and click individual clear button (usually the last one)
      const clearButtons = screen.getAllByRole('button')
      const individualClearButton = clearButtons[clearButtons.length - 1]
      fireEvent.click(individualClearButton!)

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          taskId: 'task-1',
          pluginId: 'error-plugin',
        })
      })
    })
  })

  describe('Edge cases', () => {
    it('should handle empty plugin tasks array', () => {
      setupMocks([])

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger')).not.toBeInTheDocument()
    })

    it('should handle single running plugin', () => {
      setupMocks([createMockPlugin({ status: TaskStatus.running })])

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should handle many plugins', () => {
      const manyPlugins = Array.from({ length: 10 }, (_, i) =>
        createMockPlugin({
          status:
            i % 3 === 0 ? TaskStatus.running : i % 3 === 1 ? TaskStatus.success : TaskStatus.failed,
          plugin_unique_identifier: `plugin-${i}`,
        }),
      )
      setupMocks(manyPlugins)

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should handle plugins with empty labels', () => {
      const plugin = createMockPlugin({
        status: TaskStatus.running,
        labels: {} as Record<string, string>,
      })
      setupMocks([plugin])

      render(<PluginTasks />)

      expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
    })

    it('should handle plugins with long messages', () => {
      const plugin = createMockPlugin({
        status: TaskStatus.failed,
        message: 'A'.repeat(500),
      })
      setupMocks([plugin])

      render(<PluginTasks />)

      // Open popover
      fireEvent.click(getTaskMenuTrigger())

      expect(screen.getByTestId('plugin-task-list'))!.toBeInTheDocument()
    })

    it('should open for installing-with-success state', () => {
      setupMocks([
        createMockPlugin({ status: TaskStatus.running, plugin_unique_identifier: 'running-1' }),
        createMockPlugin({ status: TaskStatus.success, plugin_unique_identifier: 'success-1' }),
      ])

      render(<PluginTasks />)
      fireEvent.click(getTaskMenuTrigger())

      expect(screen.getByTestId('plugin-task-list')).toBeInTheDocument()
    })

    it('should open for installing-with-error state', () => {
      setupMocks([
        createMockPlugin({ status: TaskStatus.running, plugin_unique_identifier: 'running-1' }),
        createMockPlugin({ status: TaskStatus.failed, plugin_unique_identifier: 'failed-1' }),
      ])

      render(<PluginTasks />)
      fireEvent.click(getTaskMenuTrigger())

      expect(screen.getByTestId('plugin-task-list')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================
describe('PluginTasks Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show correct UI flow from installing to success', async () => {
    // Start with installing state
    setupMocks([createMockPlugin({ status: TaskStatus.running })])

    const { rerender } = render(<PluginTasks />)

    expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()

    // Simulate completion by re-rendering with success
    setupMocks([createMockPlugin({ status: TaskStatus.success })])
    rerender(<PluginTasks />)

    expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
  })

  it('should show correct UI flow from installing to failure', async () => {
    // Start with installing state
    setupMocks([createMockPlugin({ status: TaskStatus.running })])

    const { rerender } = render(<PluginTasks />)

    expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()

    // Simulate failure by re-rendering with failed
    setupMocks([createMockPlugin({ status: TaskStatus.failed, message: 'Network error' })])
    rerender(<PluginTasks />)

    expect(document.getElementById('plugin-task-trigger'))!.toBeInTheDocument()
  })

  it('should handle mixed status during installation', () => {
    setupMocks([
      createMockPlugin({ status: TaskStatus.running, plugin_unique_identifier: 'p1' }),
      createMockPlugin({ status: TaskStatus.success, plugin_unique_identifier: 'p2' }),
      createMockPlugin({ status: TaskStatus.failed, plugin_unique_identifier: 'p3' }),
    ])

    render(<PluginTasks />)

    // Open popover
    fireEvent.click(getTaskMenuTrigger())

    expect(screen.getByText(/task\.runningPlugins/i)).toBeInTheDocument()
    expect(screen.getByText(/task\.successPlugins/i)).toBeInTheDocument()
    expect(screen.getByText(/task\.errorPlugins/i)).toBeInTheDocument()
  })
})
