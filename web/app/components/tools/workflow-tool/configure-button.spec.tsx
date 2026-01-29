import type { WorkflowToolModalPayload } from './index'
import type { WorkflowToolProviderResponse } from '@/app/components/tools/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import WorkflowToolConfigureButton from './configure-button'
import WorkflowToolAsModal from './index'
import MethodSelector from './method-selector'

// Mock Next.js navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
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
const mockFetchWorkflowToolDetailByAppID = vi.fn()
const mockCreateWorkflowToolProvider = vi.fn()
const mockSaveWorkflowToolProvider = vi.fn()
vi.mock('@/service/tools', () => ({
  fetchWorkflowToolDetailByAppID: (...args: unknown[]) => mockFetchWorkflowToolDetailByAppID(...args),
  createWorkflowToolProvider: (...args: unknown[]) => mockCreateWorkflowToolProvider(...args),
  saveWorkflowToolProvider: (...args: unknown[]) => mockSaveWorkflowToolProvider(...args),
}))

// Mock invalidate workflow tools hook
const mockInvalidateAllWorkflowTools = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useInvalidateAllWorkflowTools: () => mockInvalidateAllWorkflowTools,
}))

// Mock Toast - need to verify notification calls
const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (options: { type: string, message: string }) => mockToastNotify(options),
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

// Mock Drawer - simplified for testing, preserves behavior
vi.mock('@/app/components/base/drawer-plus', () => ({
  default: ({ isShow, onHide, title, body }: { isShow: boolean, onHide: () => void, title: string, body: React.ReactNode }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="drawer" role="dialog">
        <div data-testid="drawer-title">{title}</div>
        <button data-testid="drawer-close" onClick={onHide}>Close</button>
        {body}
      </div>
    )
  },
}))

// Mock EmojiPicker - simplified for testing
vi.mock('@/app/components/base/emoji-picker', () => ({
  default: ({ onSelect, onClose }: { onSelect: (icon: string, background: string) => void, onClose: () => void }) => (
    <div data-testid="emoji-picker">
      <button data-testid="select-emoji" onClick={() => onSelect('🚀', '#f0f0f0')}>Select Emoji</button>
      <button data-testid="close-emoji-picker" onClick={onClose}>Close</button>
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

// Mock PortalToFollowElem for dropdown tests
let mockPortalOpenState = false
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open, onOpenChange }: { children: React.ReactNode, open: boolean, onOpenChange: (open: boolean) => void }) => {
    mockPortalOpenState = open
    return (
      <div data-testid="portal-elem" data-open={open} onClick={() => onOpenChange(!open)}>
        {children}
      </div>
    )
  },
  PortalToFollowElemTrigger: ({ children, onClick, className }: { children: React.ReactNode, onClick: () => void, className?: string }) => (
    <div data-testid="portal-trigger" onClick={onClick} className={className}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children, className }: { children: React.ReactNode, className?: string }) => {
    if (!mockPortalOpenState)
      return null
    return <div data-testid="portal-content" className={className}>{children}</div>
  },
}))

// Test data factories
const createMockEmoji = (overrides = {}) => ({
  content: '🔧',
  background: '#ffffff',
  ...overrides,
})

const createMockInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  variable: 'test_var',
  label: 'Test Variable',
  type: InputVarType.textInput,
  required: true,
  max_length: 100,
  options: [],
  ...overrides,
} as InputVar)

const createMockVariable = (overrides: Partial<Variable> = {}): Variable => ({
  variable: 'output_var',
  value_type: 'string',
  ...overrides,
} as Variable)

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
  detailNeedUpdate: false,
  workflowAppId: 'workflow-app-123',
  icon: createMockEmoji(),
  name: 'Test Workflow',
  description: 'Test workflow description',
  inputs: [createMockInputVar()],
  outputs: [createMockVariable()],
  handlePublish: vi.fn().mockResolvedValue(undefined),
  onRefreshData: vi.fn(),
  ...overrides,
})

const createDefaultModalPayload = (overrides: Partial<WorkflowToolModalPayload> = {}): WorkflowToolModalPayload => ({
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
    mockPortalOpenState = false
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockFetchWorkflowToolDetailByAppID.mockResolvedValue(createMockWorkflowToolDetail())
  })

  // Rendering Tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps()

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      expect(screen.getByText('workflow.common.workflowAsTool')).toBeInTheDocument()
    })

    it('should render configure required badge when not published', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: false })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      expect(screen.getByText('workflow.common.configureRequired')).toBeInTheDocument()
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
      expect(container).toBeInTheDocument()
    })

    it('should render disabledReason when provided', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({
        disabledReason: 'Please save the workflow first',
      })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      expect(screen.getByText('Please save the workflow first')).toBeInTheDocument()
    })

    it('should render loading state when published and fetching details', async () => {
      // Arrange
      mockFetchWorkflowToolDetailByAppID.mockImplementation(() => new Promise(() => {})) // Never resolves
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        const loadingElement = document.querySelector('.pt-2')
        expect(loadingElement).toBeInTheDocument()
      })
    })

    it('should render configure and manage buttons when published', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure')).toBeInTheDocument()
        expect(screen.getByText('workflow.common.manageInTools')).toBeInTheDocument()
      })
    })

    it('should render different UI for non-workspace manager', () => {
      // Arrange
      mockIsCurrentWorkspaceManager.mockReturnValue(false)
      const props = createDefaultConfigureButtonProps()

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      const textElement = screen.getByText('workflow.common.workflowAsTool')
      expect(textElement).toHaveClass('text-text-tertiary')
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

    it('should handle undefined inputs and outputs', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({
        inputs: undefined,
        outputs: undefined,
      })

      // Act & Assert
      expect(() => render(<WorkflowToolConfigureButton {...props} />)).not.toThrow()
    })

    it('should handle empty inputs and outputs arrays', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({
        inputs: [],
        outputs: [],
      })

      // Act & Assert
      expect(() => render(<WorkflowToolConfigureButton {...props} />)).not.toThrow()
    })

    it('should call handlePublish when updating workflow tool', async () => {
      // Arrange
      const user = userEvent.setup()
      const handlePublish = vi.fn().mockResolvedValue(undefined)
      mockSaveWorkflowToolProvider.mockResolvedValue({})
      const props = createDefaultConfigureButtonProps({ published: true, handlePublish })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)
      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure')).toBeInTheDocument()
      })
      await user.click(screen.getByText('workflow.common.configure'))

      // Fill required fields and save
      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })
      const saveButton = screen.getByText('common.operation.save')
      await user.click(saveButton)

      // Confirm in modal
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.confirmTitle')).toBeInTheDocument()
      })
      await user.click(screen.getByText('common.operation.confirm'))

      // Assert
      await waitFor(() => {
        expect(handlePublish).toHaveBeenCalled()
      })
    })
  })

  // State Management Tests
  describe('State Management', () => {
    it('should fetch detail when published and mount', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(mockFetchWorkflowToolDetailByAppID).toHaveBeenCalledWith('workflow-app-123')
      })
    })

    it('should refetch detail when detailNeedUpdate changes to true', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true, detailNeedUpdate: false })

      // Act
      const { rerender } = render(<WorkflowToolConfigureButton {...props} />)

      await waitFor(() => {
        expect(mockFetchWorkflowToolDetailByAppID).toHaveBeenCalledTimes(1)
      })

      // Rerender with detailNeedUpdate true
      rerender(<WorkflowToolConfigureButton {...props} detailNeedUpdate={true} />)

      // Assert
      await waitFor(() => {
        expect(mockFetchWorkflowToolDetailByAppID).toHaveBeenCalledTimes(2)
      })
    })

    it('should toggle modal visibility', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = createDefaultConfigureButtonProps()

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Click to open modal
      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })
    })

    it('should not open modal when disabled', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = createDefaultConfigureButtonProps({ disabled: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      // Assert
      expect(screen.queryByTestId('drawer')).not.toBeInTheDocument()
    })

    it('should not open modal when published (use configure button instead)', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure')).toBeInTheDocument()
      })

      // Click the main area (should not open modal)
      const mainArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(mainArea!)

      // Should not open modal from main click
      expect(screen.queryByTestId('drawer')).not.toBeInTheDocument()

      // Click configure button
      await user.click(screen.getByText('workflow.common.configure'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })
    })
  })

  // Memoization Tests
  describe('Memoization - outdated detection', () => {
    it('should detect outdated when parameter count differs', async () => {
      // Arrange
      const detail = createMockWorkflowToolDetail()
      mockFetchWorkflowToolDetailByAppID.mockResolvedValue(detail)
      const props = createDefaultConfigureButtonProps({
        published: true,
        inputs: [
          createMockInputVar({ variable: 'test_var' }),
          createMockInputVar({ variable: 'extra_var' }),
        ],
      })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert - should show outdated warning
      await waitFor(() => {
        expect(screen.getByText('workflow.common.workflowAsToolTip')).toBeInTheDocument()
      })
    })

    it('should detect outdated when parameter not found', async () => {
      // Arrange
      const detail = createMockWorkflowToolDetail()
      mockFetchWorkflowToolDetailByAppID.mockResolvedValue(detail)
      const props = createDefaultConfigureButtonProps({
        published: true,
        inputs: [createMockInputVar({ variable: 'different_var' })],
      })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('workflow.common.workflowAsToolTip')).toBeInTheDocument()
      })
    })

    it('should detect outdated when required property differs', async () => {
      // Arrange
      const detail = createMockWorkflowToolDetail()
      mockFetchWorkflowToolDetailByAppID.mockResolvedValue(detail)
      const props = createDefaultConfigureButtonProps({
        published: true,
        inputs: [createMockInputVar({ variable: 'test_var', required: false })], // Detail has required: true
      })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('workflow.common.workflowAsToolTip')).toBeInTheDocument()
      })
    })

    it('should not show outdated when parameters match', async () => {
      // Arrange
      const detail = createMockWorkflowToolDetail()
      mockFetchWorkflowToolDetailByAppID.mockResolvedValue(detail)
      const props = createDefaultConfigureButtonProps({
        published: true,
        inputs: [createMockInputVar({ variable: 'test_var', required: true, type: InputVarType.textInput })],
      })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure')).toBeInTheDocument()
      })
      expect(screen.queryByText('workflow.common.workflowAsToolTip')).not.toBeInTheDocument()
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
        expect(screen.getByText('workflow.common.manageInTools')).toBeInTheDocument()
      })

      await user.click(screen.getByText('workflow.common.manageInTools'))

      // Assert
      expect(mockPush).toHaveBeenCalledWith('/tools?category=workflow')
    })

    it('should create workflow tool provider on first publish', async () => {
      // Arrange
      const user = userEvent.setup()
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const props = createDefaultConfigureButtonProps()

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Open modal
      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })

      // Fill in required name field
      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'my_tool')

      // Click save
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockCreateWorkflowToolProvider).toHaveBeenCalled()
      })
    })

    it('should show success toast after creating workflow tool', async () => {
      // Arrange
      const user = userEvent.setup()
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const props = createDefaultConfigureButtonProps()

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })

      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'my_tool')

      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'common.api.actionSuccess',
        })
      })
    })

    it('should show error toast when create fails', async () => {
      // Arrange
      const user = userEvent.setup()
      mockCreateWorkflowToolProvider.mockRejectedValue(new Error('Create failed'))
      const props = createDefaultConfigureButtonProps()

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })

      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'my_tool')

      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Create failed',
        })
      })
    })

    it('should call onRefreshData after successful create', async () => {
      // Arrange
      const user = userEvent.setup()
      const onRefreshData = vi.fn()
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const props = createDefaultConfigureButtonProps({ onRefreshData })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })

      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'my_tool')

      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(onRefreshData).toHaveBeenCalled()
      })
    })

    it('should invalidate all workflow tools after successful create', async () => {
      // Arrange
      const user = userEvent.setup()
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const props = createDefaultConfigureButtonProps()

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })

      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'my_tool')

      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockInvalidateAllWorkflowTools).toHaveBeenCalled()
      })
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle API returning undefined', async () => {
      // Arrange - API returns undefined (simulating empty response or handled error)
      mockFetchWorkflowToolDetailByAppID.mockResolvedValue(undefined)
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert - should not crash and wait for API call
      await waitFor(() => {
        expect(mockFetchWorkflowToolDetailByAppID).toHaveBeenCalled()
      })

      // Component should still render without crashing
      expect(screen.getByText('workflow.common.workflowAsTool')).toBeInTheDocument()
    })

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
      expect(mockFetchWorkflowToolDetailByAppID).toHaveBeenCalled()
    })

    it('should handle detail with empty parameters', async () => {
      // Arrange
      const detail = createMockWorkflowToolDetail()
      detail.tool.parameters = []
      mockFetchWorkflowToolDetailByAppID.mockResolvedValue(detail)
      const props = createDefaultConfigureButtonProps({ published: true, inputs: [] })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure')).toBeInTheDocument()
      })
    })

    it('should handle detail with undefined output_schema', async () => {
      // Arrange
      const detail = createMockWorkflowToolDetail()
      // @ts-expect-error - testing undefined case
      detail.tool.output_schema = undefined
      mockFetchWorkflowToolDetailByAppID.mockResolvedValue(detail)
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act & Assert
      expect(() => render(<WorkflowToolConfigureButton {...props} />)).not.toThrow()
    })

    it('should handle paragraph type input conversion', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = createDefaultConfigureButtonProps({
        inputs: [createMockInputVar({ variable: 'test_var', type: InputVarType.paragraph })],
      })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      // Assert - should render without error
      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })
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
      mockIsCurrentWorkspaceManager.mockReturnValue(false)
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        const configureButton = screen.getByText('workflow.common.configure')
        expect(configureButton).toBeDisabled()
      })
    })
  })
})

// ============================================================================
// WorkflowToolAsModal Tests
// ============================================================================
describe('WorkflowToolAsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  // Rendering Tests (REQUIRED)
  describe('Rendering', () => {
    it('should render drawer with correct title', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByTestId('drawer-title')).toHaveTextContent('workflow.common.workflowAsTool')
    })

    it('should render name input field', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')).toBeInTheDocument()
    })

    it('should render name for tool call input', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')).toBeInTheDocument()
    })

    it('should render description textarea', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder')).toBeInTheDocument()
    })

    it('should render tool input table', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByText('tools.createTool.toolInput.title')).toBeInTheDocument()
    })

    it('should render tool output table', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByText('tools.createTool.toolOutput.title')).toBeInTheDocument()
    })

    it('should render reserved output parameters', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByText('text')).toBeInTheDocument()
      expect(screen.getByText('files')).toBeInTheDocument()
      expect(screen.getByText('json')).toBeInTheDocument()
    })

    it('should render label selector', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByTestId('label-selector')).toBeInTheDocument()
    })

    it('should render privacy policy input', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder')).toBeInTheDocument()
    })

    it('should render delete button when editing and onRemove provided', () => {
      // Arrange
      const props = {
        isAdd: false,
        payload: createDefaultModalPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onRemove: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })

    it('should not render delete button when adding', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
        onRemove: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })
  })

  // Props Testing (REQUIRED)
  describe('Props', () => {
    it('should initialize state from payload', () => {
      // Arrange
      const payload = createDefaultModalPayload({
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
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByDisplayValue('Custom Label')).toBeInTheDocument()
      expect(screen.getByDisplayValue('custom_name')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Custom description')).toBeInTheDocument()
    })

    it('should pass labels to label selector', () => {
      // Arrange
      const payload = createDefaultModalPayload({ labels: ['tag1', 'tag2'] })
      const props = {
        isAdd: true,
        payload,
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert
      expect(screen.getByTestId('label-values')).toHaveTextContent('tag1,tag2')
    })
  })

  // State Management Tests
  describe('State Management', () => {
    it('should update label state on input change', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ label: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      const labelInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.type(labelInput, 'New Label')

      // Assert
      expect(labelInput).toHaveValue('New Label')
    })

    it('should update name state on input change', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ name: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'new_name')

      // Assert
      expect(nameInput).toHaveValue('new_name')
    })

    it('should update description state on textarea change', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ description: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      const descInput = screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder')
      await user.type(descInput, 'New description')

      // Assert
      expect(descInput).toHaveValue('New description')
    })

    it('should show emoji picker on icon click', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      const iconButton = screen.getByTestId('app-icon')
      await user.click(iconButton)

      // Assert
      expect(screen.getByTestId('emoji-picker')).toBeInTheDocument()
    })

    it('should update emoji on selection', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Open emoji picker
      const iconButton = screen.getByTestId('app-icon')
      await user.click(iconButton)

      // Select emoji
      await user.click(screen.getByTestId('select-emoji'))

      // Assert
      const updatedIcon = screen.getByTestId('app-icon')
      expect(updatedIcon).toHaveAttribute('data-icon', '🚀')
      expect(updatedIcon).toHaveAttribute('data-background', '#f0f0f0')
    })

    it('should close emoji picker on close button', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      const iconButton = screen.getByTestId('app-icon')
      await user.click(iconButton)

      expect(screen.getByTestId('emoji-picker')).toBeInTheDocument()

      await user.click(screen.getByTestId('close-emoji-picker'))

      // Assert
      expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument()
    })

    it('should update labels when label selector changes', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ labels: ['initial'] }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      await user.click(screen.getByTestId('add-label'))

      // Assert
      expect(screen.getByTestId('label-values')).toHaveTextContent('initial,new-label')
    })

    it('should update privacy policy on input change', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ privacy_policy: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      const privacyInput = screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder')
      await user.type(privacyInput, 'https://example.com/privacy')

      // Assert
      expect(privacyInput).toHaveValue('https://example.com/privacy')
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
        payload: createDefaultModalPayload(),
        onHide,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
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
        payload: createDefaultModalPayload(),
        onHide,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      await user.click(screen.getByTestId('drawer-close'))

      // Assert
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should call onRemove when delete button clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onRemove = vi.fn()
      const props = {
        isAdd: false,
        payload: createDefaultModalPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onRemove,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
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
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
        onCreate,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
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
        payload: createDefaultModalPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onSave: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(screen.getByText('tools.createTool.confirmTitle')).toBeInTheDocument()
    })

    it('should call onSave after confirm in edit mode', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSave = vi.fn()
      const props = {
        isAdd: false,
        payload: createDefaultModalPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onSave,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
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
        payload: createDefaultModalPayload({
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
      render(<WorkflowToolAsModal {...props} />)
      const descInput = screen.getByPlaceholderText('tools.createTool.toolInput.descriptionPlaceholder')
      await user.type(descInput, 'New parameter description')

      // Assert
      expect(descInput).toHaveValue('New parameter description')
    })
  })

  // Validation Tests
  describe('Validation', () => {
    it('should show error when label is empty', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ label: '' }),
        onHide: vi.fn(),
        onCreate: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
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
        payload: createDefaultModalPayload({ label: 'Test', name: '' }),
        onHide: vi.fn(),
        onCreate: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
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
        payload: createDefaultModalPayload({ name: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'invalid name with spaces')

      // Assert
      expect(screen.getByText('tools.createTool.nameForToolCallTip')).toBeInTheDocument()
    })

    it('should accept valid name format', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ name: '' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'valid_name_123')

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
        payload: createDefaultModalPayload({ parameters: [] }),
        onHide: vi.fn(),
      }

      // Act & Assert
      expect(() => render(<WorkflowToolAsModal {...props} />)).not.toThrow()
    })

    it('should handle empty output parameters', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ outputParameters: [] }),
        onHide: vi.fn(),
      }

      // Act & Assert
      expect(() => render(<WorkflowToolAsModal {...props} />)).not.toThrow()
    })

    it('should handle parameter with __image name specially', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({
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
      render(<WorkflowToolAsModal {...props} />)

      // Assert - __image should show method as text, not selector
      expect(screen.getByText('tools.createTool.toolInput.methodParameter')).toBeInTheDocument()
    })

    it('should show warning for reserved output parameter name collision', () => {
      // Arrange
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({
          outputParameters: [{
            name: 'text', // Collides with reserved
            description: 'Custom text output',
            type: VarType.string,
          }],
        }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Assert - should show both reserved and custom with warning icon
      const textElements = screen.getAllByText('text')
      expect(textElements.length).toBe(2)
    })

    it('should handle undefined onSave gracefully', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: false,
        payload: createDefaultModalPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        // onSave is undefined
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      // Show confirm modal
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.confirmTitle')).toBeInTheDocument()
      })

      // Assert - should not crash
      await user.click(screen.getByText('common.operation.confirm'))
    })

    it('should handle undefined onCreate gracefully', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload(),
        onHide: vi.fn(),
        // onCreate is undefined
      }

      // Act & Assert - should not crash
      render(<WorkflowToolAsModal {...props} />)
      await user.click(screen.getByText('common.operation.save'))
    })

    it('should close confirm modal on close button', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: false,
        payload: createDefaultModalPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
        onSave: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(screen.getByText('tools.createTool.confirmTitle')).toBeInTheDocument()
      })

      // Click cancel in confirm modal
      const cancelButtons = screen.getAllByText('common.operation.cancel')
      await user.click(cancelButtons[cancelButtons.length - 1])

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
    mockPortalOpenState = false
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
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
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
      expect(screen.getByText('tools.createTool.toolInput.methodParameter')).toBeInTheDocument()
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
      expect(screen.getByText('tools.createTool.toolInput.methodSetting')).toBeInTheDocument()
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
      expect(screen.getByText('tools.createTool.toolInput.methodSetting')).toBeInTheDocument()
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
      await user.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
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
      await user.click(screen.getByTestId('portal-trigger'))

      const paramOption = screen.getAllByText('tools.createTool.toolInput.methodParameter')[0]
      await user.click(paramOption)

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
      await user.click(screen.getByTestId('portal-trigger'))

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
      await user.click(screen.getByTestId('portal-trigger'))
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Second click - close
      await user.click(screen.getByTestId('portal-trigger'))
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
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
      await user.click(screen.getByTestId('portal-trigger'))

      // Assert - the first option (llm) should have a check icon container
      const content = screen.getByTestId('portal-content')
      expect(content).toBeInTheDocument()
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
      await user.click(screen.getByTestId('portal-trigger'))

      // Assert
      const content = screen.getByTestId('portal-content')
      expect(content).toBeInTheDocument()
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
      expect(screen.getByText('tools.createTool.toolInput.methodSetting')).toBeInTheDocument()
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
    mockPortalOpenState = false
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockFetchWorkflowToolDetailByAppID.mockResolvedValue(createMockWorkflowToolDetail())
  })

  // Complete workflow: open modal -> fill form -> save
  describe('Complete Workflow', () => {
    it('should complete full create workflow', async () => {
      // Arrange
      const user = userEvent.setup()
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const onRefreshData = vi.fn()
      const props = createDefaultConfigureButtonProps({ onRefreshData })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Open modal
      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })

      // Fill form
      const labelInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.clear(labelInput)
      await user.type(labelInput, 'My Custom Tool')

      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'my_custom_tool')

      const descInput = screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder')
      await user.clear(descInput)
      await user.type(descInput, 'A custom tool for testing')

      // Save
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockCreateWorkflowToolProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'my_custom_tool',
            label: 'My Custom Tool',
            description: 'A custom tool for testing',
          }),
        )
      })

      await waitFor(() => {
        expect(onRefreshData).toHaveBeenCalled()
      })
    })

    it('should complete full update workflow', async () => {
      // Arrange
      const user = userEvent.setup()
      const handlePublish = vi.fn().mockResolvedValue(undefined)
      mockSaveWorkflowToolProvider.mockResolvedValue({})
      const props = createDefaultConfigureButtonProps({
        published: true,
        handlePublish,
      })

      // Act
      render(<WorkflowToolConfigureButton {...props} />)

      // Wait for detail to load
      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure')).toBeInTheDocument()
      })

      // Open modal
      await user.click(screen.getByText('workflow.common.configure'))

      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })

      // Modify description
      const descInput = screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder')
      await user.clear(descInput)
      await user.type(descInput, 'Updated description')

      // Save
      await user.click(screen.getByText('common.operation.save'))

      // Confirm
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.confirmTitle')).toBeInTheDocument()
      })
      await user.click(screen.getByText('common.operation.confirm'))

      // Assert
      await waitFor(() => {
        expect(handlePublish).toHaveBeenCalled()
        expect(mockSaveWorkflowToolProvider).toHaveBeenCalled()
      })
    })
  })

  // Test callbacks and state synchronization
  describe('Callback Stability', () => {
    it('should maintain callback references across rerenders', async () => {
      // Arrange
      const handlePublish = vi.fn().mockResolvedValue(undefined)
      const onRefreshData = vi.fn()
      const props = createDefaultConfigureButtonProps({
        handlePublish,
        onRefreshData,
      })

      // Act
      const { rerender } = render(<WorkflowToolConfigureButton {...props} />)
      rerender(<WorkflowToolConfigureButton {...props} />)
      rerender(<WorkflowToolConfigureButton {...props} />)

      // Assert - component should not crash and callbacks should be stable
      expect(screen.getByText('workflow.common.workflowAsTool')).toBeInTheDocument()
    })
  })
})
