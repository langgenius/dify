import type { WorkflowToolDrawerPayload } from '../index'
import type { WorkflowToolProviderResponse } from '@/app/components/tools/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import WorkflowToolConfigureButton from '../configure-button'
import { WorkflowToolDrawer } from '../index'
import MethodSelector from '../method-selector'

vi.mock('@langgenius/dify-ui/popover', () => import('@/__mocks__/base-ui-popover'))

// Mock Next.js navigation
const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/app/workflow-app-id',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock app context
const mockIsCurrentWorkspaceManager = vi.fn(() => true)
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager(),
  }),
}))

// Mock API services - only mock external services
const mockCreateWorkflowToolProvider = vi.fn()
const mockSaveWorkflowToolProvider = vi.fn()
vi.mock('@/service/tools', () => ({
  createWorkflowToolProvider: (...args: unknown[]) => mockCreateWorkflowToolProvider(...args),
  saveWorkflowToolProvider: (...args: unknown[]) => mockSaveWorkflowToolProvider(...args),
}))

// Mock service hooks
const mockInvalidateAllWorkflowTools = vi.fn()
const mockInvalidateWorkflowToolDetailByAppID = vi.fn()
const mockUseWorkflowToolDetailByAppID = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useInvalidateAllWorkflowTools: () => mockInvalidateAllWorkflowTools,
  useInvalidateWorkflowToolDetailByAppID: () => mockInvalidateWorkflowToolDetailByAppID,
  useWorkflowToolDetailByAppID: (...args: unknown[]) => mockUseWorkflowToolDetailByAppID(...args),
}))

// Mock Toast - need to verify notification calls
const mockToastNotify = vi.fn()
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
    warning: (message: string) => mockToastNotify({ type: 'warning', message }),
    info: (message: string) => mockToastNotify({ type: 'info', message }),
  },
}))

// Mock useTags hook used by LabelSelector - returns empty tags for testing
vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: [
      { name: 'label1', label: 'Label 1' },
      { name: 'label2', label: 'Label 2' },
    ],
  }),
}))

// Mock EmojiPickerInner - simplified for testing
vi.mock('@/app/components/base/emoji-picker/Inner', () => ({
  default: ({ onSelect }: { onSelect: (icon: string, background: string) => void }) => (
    <div data-testid="emoji-picker">
      <button data-testid="select-emoji" onClick={() => onSelect('🚀', '#f0f0f0')}>Select Emoji</button>
    </div>
  ),
}))

// Mock AppIcon - simplified for testing
vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick, icon, background }: { onClick?: () => void, icon: string, background: string }) => (
    <div data-testid="app-icon" onClick={onClick} data-icon={icon} data-background={background}>
      {icon}
    </div>
  ),
}))

// Mock LabelSelector - simplified for testing
vi.mock('@/app/components/tools/labels/selector', () => ({
  default: ({ value, onChange }: { value: string[], onChange: (labels: string[]) => void }) => (
    <div data-testid="label-selector">
      <span data-testid="label-values">{value.join(',')}</span>
      <button data-testid="add-label" onClick={() => onChange([...value, 'new-label'])}>Add Label</button>
    </div>
  ),
}))

// Test data factories
const createMockEmoji = (overrides = {}) => ({
  content: '🔧',
  background: '#ffffff',
  ...overrides,
})

const createMockWorkflowToolDetail = (overrides: Partial<WorkflowToolProviderResponse> = {}): WorkflowToolProviderResponse => ({
  workflow_app_id: 'workflow-app-123',
  workflow_tool_id: 'workflow-tool-456',
  label: 'Test Tool',
  name: 'test_tool',
  icon: createMockEmoji(),
  description: 'A test workflow tool',
  synced: true,
  tool: {
    author: 'test-author',
    name: 'test_tool',
    label: { en_US: 'Test Tool', zh_Hans: '测试工具' },
    description: { en_US: 'Test description', zh_Hans: '测试描述' },
    labels: ['label1', 'label2'],
    parameters: [
      {
        name: 'test_var',
        label: { en_US: 'Test Variable', zh_Hans: '测试变量' },
        human_description: { en_US: 'A test variable', zh_Hans: '测试变量' },
        type: 'string',
        form: 'llm',
        llm_description: 'Test variable description',
        required: true,
        default: '',
      },
    ],
    output_schema: {
      type: 'object',
      properties: {
        output_var: {
          type: 'string',
          description: 'Output description',
        },
      },
    },
  },
  privacy_policy: 'https://example.com/privacy',
  ...overrides,
})

const createDefaultConfigureButtonProps = (overrides = {}) => ({
  disabled: false,
  published: false,
  isLoading: false,
  outdated: false,
  isCurrentWorkspaceManager: true,
  onConfigure: vi.fn(),
  ...overrides,
})

const createDefaultDrawerPayload = (overrides: Partial<WorkflowToolDrawerPayload> = {}): WorkflowToolDrawerPayload => ({
  icon: createMockEmoji(),
  label: 'Test Tool',
  name: 'test_tool',
  description: 'Test description',
  parameters: [
    {
      name: 'param1',
      description: 'Parameter 1',
      form: 'llm',
      required: true,
      type: 'string',
    },
  ],
  outputParameters: [
    {
      name: 'output1',
      description: 'Output 1',
    },
  ],
  labels: ['label1'],
  privacy_policy: '',
  workflow_app_id: 'workflow-app-123',
  ...overrides,
})

// ============================================================================
// WorkflowToolConfigureButton Tests
// ============================================================================
describe('WorkflowToolConfigureButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockUseWorkflowToolDetailByAppID.mockImplementation((_appId: string, enabled: boolean) => ({
      data: enabled ? createMockWorkflowToolDetail() : undefined,
      isLoading: false,
    }))
  })

  // Rendering Tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps()

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('workflow.common.workflowAsTool'))!.toBeInTheDocument()
    })

    it('should render configure required badge when not published', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: false })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('workflow.common.configureRequired'))!.toBeInTheDocument()
    })

    it('should not render configure required badge when published', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByText('workflow.common.configureRequired')).not.toBeInTheDocument()
      })
    })

    it('should render disabled state with cursor-not-allowed', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ disabled: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      const container = document.querySelector('.cursor-not-allowed')
      expect(container)!.toBeInTheDocument()
    })

    it('should render disabledReason when provided', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({
        disabledReason: 'Please save the workflow first',
      })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('Please save the workflow first'))!.toBeInTheDocument()
    })

    it('should render loading state when published and fetching details', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true, isLoading: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      const loadingElement = document.querySelector('.pt-2')
      expect(loadingElement)!.toBeInTheDocument()
    })

    it('should render configure and manage buttons when published', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure'))!.toBeInTheDocument()
        expect(screen.getByText('workflow.common.manageInTools'))!.toBeInTheDocument()
      })
    })

    it('should render different UI for non-workspace manager', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ isCurrentWorkspaceManager: false })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      const textElement = screen.getByText('workflow.common.workflowAsTool')
      expect(textElement)!.toHaveClass('text-text-tertiary')
    })
  })

  // Props Testing (REQUIRED)
  describe('Props', () => {
    it('should handle all required props', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps()

      // Act & Assert - should not throw
      expect(() => render(<WorkflowToolConfigureButton {...props} />)).not.toThrow()
    })

    it('should render without disabled reason', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ disabledReason: undefined })

      // Act & Assert
      expect(() => render(<WorkflowToolConfigureButton {...props} />)).not.toThrow()
    })

    it('should handle configured callback props', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ onConfigure: vi.fn() })

      // Act & Assert
      expect(() => render(<WorkflowToolConfigureButton {...props} />)).not.toThrow()
    })
  })

  // Drawer behavior tests
  describe('Drawer Behavior', () => {
    it('should request configuration from the unpublished entry point', async () => {
      // Arrange
      const user = userEvent.setup()
      const onConfigure = vi.fn()
      const props = createDefaultConfigureButtonProps({ onConfigure })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Click to request opening the drawer
      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      expect(onConfigure).toHaveBeenCalledTimes(1)
    })

    it('should not request configuration when disabled', async () => {
      // Arrange
      const user = userEvent.setup()
      const onConfigure = vi.fn()
      const props = createDefaultConfigureButtonProps({ disabled: true, onConfigure })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      expect(onConfigure).not.toHaveBeenCalled()
    })

    it('should request configuration from the published configure button only', async () => {
      // Arrange
      const user = userEvent.setup()
      const onConfigure = vi.fn()
      const props = createDefaultConfigureButtonProps({ published: true, onConfigure })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure'))!.toBeInTheDocument()
      })

      // Click the main area (should not request opening the drawer)
      const mainArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(mainArea!)

      expect(onConfigure).not.toHaveBeenCalled()

      // Click configure button
      await user.click(screen.getByText('workflow.common.configure'))

      expect(onConfigure).toHaveBeenCalledTimes(1)
    })
  })

  // User Interactions Tests
  describe('User Interactions', () => {
    it('should navigate to tools page when manage button clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      await waitFor(() => {
        expect(screen.getByText('workflow.common.manageInTools'))!.toBeInTheDocument()
      })

      await user.click(screen.getByText('workflow.common.manageInTools'))

      // Assert
      expect(mockPush).toHaveBeenCalledWith('/tools?category=workflow')
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle rapid publish/unpublish state changes', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: false })

      // Act
      const { rerender } = render(<WorkflowToolConfigureButton {...props} />)

      // Toggle published state rapidly
      await act(async () => {
        rerender(<WorkflowToolConfigureButton {...props} published={true} />)
      })
      await act(async () => {
        rerender(<WorkflowToolConfigureButton {...props} published={false} />)
      })
      await act(async () => {
        rerender(<WorkflowToolConfigureButton {...props} published={true} />)
      })

      // Assert - should not crash
      // Assert - should not crash
      expect(screen.getByText('workflow.common.workflowAsTool'))!.toBeInTheDocument()
    })

    it('should keep the configure entry independent from workflow parameter shape', async () => {
      // Arrange
      const user = userEvent.setup()
      const onConfigure = vi.fn()
      const props = createDefaultConfigureButtonProps({ onConfigure })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      expect(onConfigure).toHaveBeenCalledTimes(1)
    })
  })

  // Accessibility Tests
  describe('Accessibility', () => {
    it('should have accessible buttons when published', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        const buttons = screen.getAllByRole('button')
        expect(buttons.length).toBeGreaterThan(0)
      })
    })

    it('should disable configure button when not workspace manager', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true, isCurrentWorkspaceManager: false })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        const configureButton = screen.getByText('workflow.common.configure')
        expect(configureButton)!.toBeDisabled()
      })
    })
  })
})

// ============================================================================
// WorkflowToolDrawer Tests
// ============================================================================
describe('WorkflowToolDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering Tests (REQUIRED)
  describe('Rendering', () => {
    it('should render drawer with correct title', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByTestId('drawer-title'))!.toHaveTextContent('workflow.common.workflowAsTool')
    })

    it('should render name input field', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder'))!.toBeInTheDocument()
    })

    it('should render name for tool call input', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder'))!.toBeInTheDocument()
    })

    it('should render description textarea', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder'))!.toBeInTheDocument()
    })

    it('should render tool input table', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('tools.createTool.toolInput.title'))!.toBeInTheDocument()
    })

    it('should render tool output table', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('tools.createTool.toolOutput.title'))!.toBeInTheDocument()
    })

    it('should render reserved output parameters', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('text'))!.toBeInTheDocument()
      expect(screen.getByText('files'))!.toBeInTheDocument()
      expect(screen.getByText('json'))!.toBeInTheDocument()
    })

    it('should render label selector', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByTestId('label-selector'))!.toBeInTheDocument()
    })

    it('should render privacy policy input', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder'))!.toBeInTheDocument()
    })

    it('should render delete button when editing and onRemove provided', () => {
      // Arrange
      const props = {
        isAdd: false,
        payload: createDefaultDrawerPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onRemove: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('common.operation.delete'))!.toBeInTheDocument()
    })

    it('should not render delete button when adding', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
        onRemove: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })
  })

  // Props Testing (REQUIRED)
  describe('Props', () => {
    it('should initialize state from payload', () => {
      // Arrange
      const payload = createDefaultDrawerPayload({
        label: 'Custom Label',
        name: 'custom_name',
        description: 'Custom description',
      })
      const props = {
        isAdd: true,
        payload,
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByDisplayValue('Custom Label'))!.toBeInTheDocument()
      expect(screen.getByDisplayValue('custom_name'))!.toBeInTheDocument()
      expect(screen.getByDisplayValue('Custom description'))!.toBeInTheDocument()
    })

    it('should pass labels to label selector', () => {
      // Arrange
      const payload = createDefaultDrawerPayload({ labels: ['tag1', 'tag2'] })
      const props = {
        isAdd: true,
        payload,
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert
      // Assert
      expect(screen.getByTestId('label-values'))!.toHaveTextContent('tag1,tag2')
    })
  })

  // State Management Tests
  describe('State Management', () => {
    it('should update label state on input change', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ label: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      const labelInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.type(labelInput, 'New Label')

      // Assert
      // Assert
      expect(labelInput)!.toHaveValue('New Label')
    })

    it('should update name state on input change', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ name: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'new_name')

      // Assert
      // Assert
      expect(nameInput)!.toHaveValue('new_name')
    })

    it('should update description state on textarea change', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ description: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      const descInput = screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder')
      await user.type(descInput, 'New description')

      // Assert
      // Assert
      expect(descInput)!.toHaveValue('New description')
    })

    it('should show emoji picker on icon click', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      const iconButton = screen.getByTestId('app-icon')
      await user.click(iconButton)

      // Assert
      // Assert
      expect(screen.getByTestId('emoji-picker'))!.toBeInTheDocument()
    })

    it('should update emoji on selection', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Open emoji picker
      const iconButton = screen.getByTestId('app-icon')
      await user.click(iconButton)

      // Select emoji
      await user.click(screen.getByTestId('select-emoji'))
      await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))

      // Assert
      const updatedIcon = screen.getByTestId('app-icon')
      expect(updatedIcon)!.toHaveAttribute('data-icon', '🚀')
      expect(updatedIcon)!.toHaveAttribute('data-background', '#f0f0f0')
    })

    it('should close emoji picker on close button', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      const iconButton = screen.getByTestId('app-icon')
      await user.click(iconButton)

      expect(screen.getByTestId('emoji-picker'))!.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'app.iconPicker.cancel' }))

      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument()
    })

    it('should update labels when label selector changes', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ labels: ['initial'] }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByTestId('add-label'))

      // Assert
      // Assert
      expect(screen.getByTestId('label-values'))!.toHaveTextContent('initial,new-label')
    })

    it('should update privacy policy on input change', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ privacy_policy: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      const privacyInput = screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder')
      await user.type(privacyInput, 'https://example.com/privacy')

      // Assert
      // Assert
      expect(privacyInput)!.toHaveValue('https://example.com/privacy')
    })
  })

  // User Interactions Tests
  describe('User Interactions', () => {
    it('should call onHide when cancel button clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onHide = vi.fn()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide,
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should call onHide when drawer close button clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onHide = vi.fn()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide,
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByRole('button', { name: /Close|operation.close/ }))

      // Assert
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should call onRemove when delete button clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onRemove = vi.fn()
      const props = {
        isAdd: false,
        payload: createDefaultDrawerPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onRemove,
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.delete'))

      // Assert
      expect(onRemove).toHaveBeenCalledTimes(1)
    })

    it('should call onCreate when save clicked in add mode', async () => {
      // Arrange
      const user = userEvent.setup()
      const onCreate = vi.fn()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
        onCreate,
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test_tool',
        workflow_app_id: 'workflow-app-123',
      }))
    })

    it('should show confirm modal when save clicked in edit mode', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: false,
        payload: createDefaultDrawerPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onSave: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      // Assert
      expect(screen.getByText('tools.createTool.confirmTitle'))!.toBeInTheDocument()
    })

    it('should call onSave after confirm in edit mode', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSave = vi.fn()
      const props = {
        isAdd: false,
        payload: createDefaultDrawerPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onSave,
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.save'))
      await user.click(screen.getByText('common.operation.confirm'))

      // Assert
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        workflow_tool_id: 'tool-123',
      }))
    })

    it('should update parameter description on input', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({
          parameters: [{
            name: 'param1',
            description: '', // Start with empty description
            form: 'llm',
            required: true,
            type: 'string',
          }],
        }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      const descInput = screen.getByPlaceholderText('tools.createTool.toolInput.descriptionPlaceholder')
      await user.type(descInput, 'New parameter description')

      // Assert
      // Assert
      expect(descInput)!.toHaveValue('New parameter description')
    })
  })

  // Validation Tests
  describe('Validation', () => {
    it('should show error when label is empty', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ label: '' }),
        onHide: vi.fn(),
        onCreate: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
    })

    it('should show error when name is empty', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ label: 'Test', name: '' }),
        onHide: vi.fn(),
        onCreate: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
    })

    it('should show validation error for invalid name format', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ name: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'invalid name with spaces')

      // Assert
      // Assert
      expect(screen.getByText('tools.createTool.nameForToolCallTip'))!.toBeInTheDocument()
    })

    it('should accept valid name format', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ name: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'valid_name_123')

      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      expect(screen.queryByText('tools.createTool.nameForToolCallTip')).not.toBeInTheDocument()
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle empty parameters array', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ parameters: [] }),
        onHide: vi.fn(),
      }

      // Act & Assert
      expect(() => render(<WorkflowToolDrawer {...props} />)).not.toThrow()
    })

    it('should handle empty output parameters', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({ outputParameters: [] }),
        onHide: vi.fn(),
      }

      // Act & Assert
      expect(() => render(<WorkflowToolDrawer {...props} />)).not.toThrow()
    })

    it('should handle parameter with __image name specially', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({
          parameters: [{
            name: '__image',
            description: 'Image parameter',
            form: 'llm',
            required: true,
            type: 'file',
          }],
        }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert - __image should show method as text, not selector
      // Assert - __image should show method as text, not selector
      expect(screen.getByText('tools.createTool.toolInput.methodParameter'))!.toBeInTheDocument()
    })

    it('should show warning for reserved output parameter name collision', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload({
          outputParameters: [{
            name: 'text', // Collides with reserved
            description: 'Custom text output',
            type: VarType.string,
          }],
        }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)

      // Assert - should show both reserved and custom with warning icon
      const textElements = screen.getAllByText('text')
      expect(textElements.length).toBe(2)
    })

    it('should handle undefined onSave gracefully', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: false,
        payload: createDefaultDrawerPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        // onSave is undefined
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      // Show confirm modal
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.confirmTitle'))!.toBeInTheDocument()
      })

      // Assert - should not crash
      await user.click(screen.getByText('common.operation.confirm'))
    })

    it('should handle undefined onCreate gracefully', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultDrawerPayload(),
        onHide: vi.fn(),
        // onCreate is undefined
      }

      // Act & Assert - should not crash
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.save'))
    })

    it('should close confirm modal on close button', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: false,
        payload: createDefaultDrawerPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onSave: vi.fn(),
      }

      // Act
      render(<WorkflowToolDrawer {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(screen.getByText('tools.createTool.confirmTitle'))!.toBeInTheDocument()
      })

      // Click cancel in confirm modal
      const cancelButtons = screen.getAllByText('common.operation.cancel')
      await user.click(cancelButtons[cancelButtons.length - 1]!)

      // Assert
      await waitFor(() => {
        expect(screen.queryByText('tools.createTool.confirmTitle')).not.toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// MethodSelector Tests
// ============================================================================
describe('MethodSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering Tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = {
        value: 'llm',
        onChange: vi.fn(),
      }

      // Act
      render(<MethodSelector {...props} />)

      // Assert
      // Assert
      expect(screen.getByTestId('popover-trigger'))!.toBeInTheDocument()
    })

    it('should display parameter method text when value is llm', () => {
      // Arrange
      const props = {
        value: 'llm',
        onChange: vi.fn(),
      }

      // Act
      render(<MethodSelector {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('tools.createTool.toolInput.methodParameter'))!.toBeInTheDocument()
    })

    it('should display setting method text when value is form', () => {
      // Arrange
      const props = {
        value: 'form',
        onChange: vi.fn(),
      }

      // Act
      render(<MethodSelector {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('tools.createTool.toolInput.methodSetting'))!.toBeInTheDocument()
    })

    it('should display setting method text when value is undefined', () => {
      // Arrange
      const props = {
        value: undefined,
        onChange: vi.fn(),
      }

      // Act
      render(<MethodSelector {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('tools.createTool.toolInput.methodSetting'))!.toBeInTheDocument()
    })
  })

  // User Interactions Tests
  describe('User Interactions', () => {
    it('should open dropdown on trigger click', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        value: 'llm',
        onChange: vi.fn(),
      }

      // Act
      render(<MethodSelector {...props} />)
      await user.click(screen.getByTestId('popover-trigger'))

      // Assert
      // Assert
      expect(screen.getByTestId('popover-content'))!.toBeInTheDocument()
    })

    it('should call onChange with llm when parameter option clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn()
      const props = {
        value: 'form',
        onChange,
      }

      // Act
      render(<MethodSelector {...props} />)
      await user.click(screen.getByTestId('popover-trigger'))

      const paramOption = screen.getAllByText('tools.createTool.toolInput.methodParameter')[0]
      await user.click(paramOption!)

      // Assert
      expect(onChange).toHaveBeenCalledWith('llm')
    })

    it('should call onChange with form when setting option clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn()
      const props = {
        value: 'llm',
        onChange,
      }

      // Act
      render(<MethodSelector {...props} />)
      await user.click(screen.getByTestId('popover-trigger'))

      const settingOption = screen.getByText('tools.createTool.toolInput.methodSetting')
      await user.click(settingOption)

      // Assert
      expect(onChange).toHaveBeenCalledWith('form')
    })

    it('should toggle dropdown state on multiple clicks', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        value: 'llm',
        onChange: vi.fn(),
      }

      // Act
      render(<MethodSelector {...props} />)

      // First click - open
      await user.click(screen.getByTestId('popover-trigger'))
      expect(screen.getByTestId('popover-content'))!.toBeInTheDocument()

      // Second click - close
      await user.click(screen.getByTestId('popover-trigger'))
      expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
    })
  })

  // Props Tests (REQUIRED)
  describe('Props', () => {
    it('should show check icon for selected llm value', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        value: 'llm',
        onChange: vi.fn(),
      }

      // Act
      render(<MethodSelector {...props} />)
      await user.click(screen.getByTestId('popover-trigger'))

      // Assert - the first option (llm) should have a check icon container
      const content = screen.getByTestId('popover-content')
      expect(content)!.toBeInTheDocument()
    })

    it('should show check icon for selected form value', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        value: 'form',
        onChange: vi.fn(),
      }

      // Act
      render(<MethodSelector {...props} />)
      await user.click(screen.getByTestId('popover-trigger'))

      // Assert
      const content = screen.getByTestId('popover-content')
      expect(content)!.toBeInTheDocument()
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle rapid value changes', async () => {
      // Arrange
      const onChange = vi.fn()
      const props = {
        value: 'llm',
        onChange,
      }

      // Act
      const { rerender } = render(<MethodSelector {...props} />)
      rerender(<MethodSelector {...props} value="form" />)
      rerender(<MethodSelector {...props} value="llm" />)
      rerender(<MethodSelector {...props} value="form" />)

      // Assert - should not crash
      // Assert - should not crash
      expect(screen.getByText('tools.createTool.toolInput.methodSetting'))!.toBeInTheDocument()
    })

    it('should handle empty string value', () => {
      // Arrange
      const props = {
        value: '',
        onChange: vi.fn(),
      }

      // Act & Assert
      expect(() => render(<MethodSelector {...props} />)).not.toThrow()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================
describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockUseWorkflowToolDetailByAppID.mockImplementation((_appId: string, enabled: boolean) => ({
      data: enabled ? createMockWorkflowToolDetail() : undefined,
      isLoading: false,
    }))
  })

  // Complete workflow: open drawer -> fill form -> save
  describe('Complete Workflow', () => {
    it('should complete full create workflow', async () => {
      // Arrange
      const user = userEvent.setup()
      const onCreate = vi.fn()

      // Act
      render(
        <WorkflowToolDrawer
          isAdd
          payload={createDefaultDrawerPayload()}
          onHide={vi.fn()}
          onCreate={onCreate}
        />,
      )

      // Fill form
      const labelInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.clear(labelInput)
      await user.type(labelInput, 'My Custom Tool')

      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.clear(nameInput)
      await user.type(nameInput, 'my_custom_tool')

      const descInput = screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder')
      await user.clear(descInput)
      await user.type(descInput, 'A custom tool for testing')

      // Save
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'my_custom_tool',
            label: 'My Custom Tool',
            description: 'A custom tool for testing',
          }),
        )
      })
    })

    it('should complete full update workflow', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSave = vi.fn()

      // Act
      render(
        <WorkflowToolDrawer
          isAdd={false}
          payload={createDefaultDrawerPayload({ workflow_tool_id: 'workflow-tool-1' })}
          onHide={vi.fn()}
          onSave={onSave}
        />,
      )

      // Modify description
      const descInput = screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder')
      await user.clear(descInput)
      await user.type(descInput, 'Updated description')

      // Save
      await user.click(screen.getByText('common.operation.save'))

      // Confirm
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.confirmTitle'))!.toBeInTheDocument()
      })
      await user.click(screen.getByText('common.operation.confirm'))

      // Assert
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
          workflow_tool_id: 'workflow-tool-1',
          description: 'Updated description',
        }))
      })
    })
  })

  // Test callbacks and state synchronization
  describe('Callback Stability', () => {
    it('should maintain callback references across rerenders', async () => {
      // Arrange
      const onConfigure = vi.fn()
      const props = createDefaultConfigureButtonProps({
        onConfigure,
      })

      // Act
      const { rerender } = render(<WorkflowToolConfigureButton {...props} />)
      rerender(<WorkflowToolConfigureButton {...props} />)
      rerender(<WorkflowToolConfigureButton {...props} />)

      // Assert - component should not crash and callbacks should be stable
      // Assert - component should not crash and callbacks should be stable
      expect(screen.getByText('workflow.common.workflowAsTool'))!.toBeInTheDocument()
    })
  })
})
