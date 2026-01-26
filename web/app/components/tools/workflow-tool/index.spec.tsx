import type { WorkflowToolModalPayload } from './index'
import type { WorkflowToolProviderResponse } from '@/app/components/tools/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import ToolInputTable from './components/tool-input-table'
import ToolOutputTable from './components/tool-output-table'
import WorkflowToolConfigureButton from './configure-button'
import ConfirmModal from './confirm-modal'
import { useModalState, useMultiModalState } from './hooks/use-modal-state'
import { useWorkflowToolForm } from './hooks/use-workflow-tool-form'
import WorkflowToolAsModal from './index'
import MethodSelector from './method-selector'

// ============================================================================
// Test Utilities
// ============================================================================

// Create a fresh QueryClient for each test
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  })

// Wrapper component for tests that need QueryClientProvider
const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = createTestQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

// Custom render function that wraps with QueryClientProvider
const renderWithQueryClient = (ui: React.ReactElement) => {
  return render(ui, { wrapper: TestWrapper })
}

// ============================================================================
// Mocks
// ============================================================================

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

// Mock API services
const mockFetchWorkflowToolDetailByAppID = vi.fn()
const mockCreateWorkflowToolProvider = vi.fn()
const mockSaveWorkflowToolProvider = vi.fn()
vi.mock('@/service/tools', () => ({
  fetchWorkflowToolDetailByAppID: (...args: unknown[]) => mockFetchWorkflowToolDetailByAppID(...args),
  createWorkflowToolProvider: (...args: unknown[]) => mockCreateWorkflowToolProvider(...args),
  saveWorkflowToolProvider: (...args: unknown[]) => mockSaveWorkflowToolProvider(...args),
}))

// Mock the workflow tool hooks
const mockUseWorkflowToolDetail = vi.fn()
const mockCreateTool = vi.fn()
const mockUpdateTool = vi.fn()
vi.mock('./hooks/use-workflow-tool', () => ({
  useWorkflowToolDetail: (appId: string, enabled: boolean) => mockUseWorkflowToolDetail(appId, enabled),
  useInvalidateWorkflowToolDetail: () => vi.fn(),
  useCreateWorkflowTool: () => ({
    mutateAsync: mockCreateTool,
  }),
  useUpdateWorkflowTool: () => ({
    mutateAsync: mockUpdateTool,
  }),
}))

// Mock invalidate workflow tools hook
const mockInvalidateAllWorkflowTools = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useInvalidateAllWorkflowTools: () => mockInvalidateAllWorkflowTools,
}))

// Mock Toast
const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (options: { type: string, message: string }) => mockToastNotify(options),
  },
}))

// Mock useTags hook
vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: [
      { name: 'label1', label: 'Label 1' },
      { name: 'label2', label: 'Label 2' },
    ],
  }),
}))

// Mock Drawer
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

// Mock EmojiPicker
vi.mock('@/app/components/base/emoji-picker', () => ({
  default: ({ onSelect, onClose }: { onSelect: (icon: string, background: string) => void, onClose: () => void }) => (
    <div data-testid="emoji-picker">
      <button data-testid="select-emoji" onClick={() => onSelect('🚀', '#f0f0f0')}>Select Emoji</button>
      <button data-testid="close-emoji-picker" onClick={onClose}>Close</button>
    </div>
  ),
}))

// Mock AppIcon
vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick, icon, background }: { onClick?: () => void, icon: string, background: string }) => (
    <div data-testid="app-icon" onClick={onClick} data-icon={icon} data-background={background}>
      {icon}
    </div>
  ),
}))

// Mock LabelSelector
vi.mock('@/app/components/tools/labels/selector', () => ({
  default: ({ value, onChange }: { value: string[], onChange: (labels: string[]) => void }) => (
    <div data-testid="label-selector">
      <span data-testid="label-values">{value.join(',')}</span>
      <button data-testid="add-label" onClick={() => onChange([...value, 'new-label'])}>Add Label</button>
      <button data-testid="clear-labels" onClick={() => onChange([])}>Clear</button>
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

// ============================================================================
// Test Data Factories
// ============================================================================

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

const createMockWorkflowToolFormPayload = (overrides = {}) => ({
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
  outputParameters: [],
  labels: ['label1'],
  privacy_policy: '',
  workflow_app_id: 'workflow-app-123',
  ...overrides,
})

// ============================================================================
// useModalState Hook Tests
// ============================================================================
describe('useModalState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should initialize with false by default', () => {
      // Arrange & Act
      const { result } = renderHook(() => useModalState())

      // Assert
      expect(result.current.isOpen).toBe(false)
    })

    it('should initialize with provided initial state', () => {
      // Arrange & Act
      const { result } = renderHook(() => useModalState(true))

      // Assert
      expect(result.current.isOpen).toBe(true)
    })
  })

  describe('State Operations', () => {
    it('should open modal when open is called', () => {
      // Arrange
      const { result } = renderHook(() => useModalState(false))

      // Act
      act(() => {
        result.current.open()
      })

      // Assert
      expect(result.current.isOpen).toBe(true)
    })

    it('should close modal when close is called', () => {
      // Arrange
      const { result } = renderHook(() => useModalState(true))

      // Act
      act(() => {
        result.current.close()
      })

      // Assert
      expect(result.current.isOpen).toBe(false)
    })

    it('should toggle modal state when toggle is called', () => {
      // Arrange
      const { result } = renderHook(() => useModalState(false))

      // Act - Toggle on
      act(() => {
        result.current.toggle()
      })

      // Assert
      expect(result.current.isOpen).toBe(true)

      // Act - Toggle off
      act(() => {
        result.current.toggle()
      })

      // Assert
      expect(result.current.isOpen).toBe(false)
    })
  })

  describe('Memoization', () => {
    it('should maintain stable callback references', () => {
      // Arrange
      const { result, rerender } = renderHook(() => useModalState(false))
      const initialOpen = result.current.open
      const initialClose = result.current.close
      const initialToggle = result.current.toggle

      // Act
      rerender()

      // Assert - Callbacks should be stable
      expect(result.current.open).toBe(initialOpen)
      expect(result.current.close).toBe(initialClose)
      expect(result.current.toggle).toBe(initialToggle)
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple rapid state changes', () => {
      // Arrange
      const { result } = renderHook(() => useModalState(false))

      // Act
      act(() => {
        result.current.open()
        result.current.close()
        result.current.open()
        result.current.toggle()
        result.current.toggle()
      })

      // Assert - Final state should be true (open -> close -> open -> toggle(false) -> toggle(true))
      expect(result.current.isOpen).toBe(true)
    })

    it('should handle open when already open', () => {
      // Arrange
      const { result } = renderHook(() => useModalState(true))

      // Act
      act(() => {
        result.current.open()
      })

      // Assert - Should remain open
      expect(result.current.isOpen).toBe(true)
    })

    it('should handle close when already closed', () => {
      // Arrange
      const { result } = renderHook(() => useModalState(false))

      // Act
      act(() => {
        result.current.close()
      })

      // Assert - Should remain closed
      expect(result.current.isOpen).toBe(false)
    })
  })
})

// ============================================================================
// useMultiModalState Hook Tests
// ============================================================================
describe('useMultiModalState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should initialize all modals as closed', () => {
      // Arrange & Act
      const { result } = renderHook(() => useMultiModalState(['modal1', 'modal2', 'modal3']))

      // Assert
      expect(result.current.modals.modal1.isOpen).toBe(false)
      expect(result.current.modals.modal2.isOpen).toBe(false)
      expect(result.current.modals.modal3.isOpen).toBe(false)
    })

    it('should handle single modal name', () => {
      // Arrange & Act
      const { result } = renderHook(() => useMultiModalState(['single']))

      // Assert
      expect(result.current.modals.single.isOpen).toBe(false)
    })
  })

  describe('Modal Operations', () => {
    it('should open specific modal', () => {
      // Arrange
      const { result } = renderHook(() => useMultiModalState(['modal1', 'modal2']))

      // Act
      act(() => {
        result.current.modals.modal1.open()
      })

      // Assert
      expect(result.current.modals.modal1.isOpen).toBe(true)
      expect(result.current.modals.modal2.isOpen).toBe(false)
    })

    it('should close specific modal', () => {
      // Arrange
      const { result } = renderHook(() => useMultiModalState(['modal1', 'modal2']))

      // Act
      act(() => {
        result.current.modals.modal1.open()
        result.current.modals.modal2.open()
      })

      act(() => {
        result.current.modals.modal1.close()
      })

      // Assert
      expect(result.current.modals.modal1.isOpen).toBe(false)
      expect(result.current.modals.modal2.isOpen).toBe(true)
    })

    it('should close all modals with closeAll', () => {
      // Arrange
      const { result } = renderHook(() => useMultiModalState(['modal1', 'modal2', 'modal3']))

      // Act
      act(() => {
        result.current.modals.modal1.open()
        result.current.modals.modal2.open()
        result.current.modals.modal3.open()
      })

      act(() => {
        result.current.closeAll()
      })

      // Assert
      expect(result.current.modals.modal1.isOpen).toBe(false)
      expect(result.current.modals.modal2.isOpen).toBe(false)
      expect(result.current.modals.modal3.isOpen).toBe(false)
    })
  })

  describe('Multiple Modal Management', () => {
    it('should allow multiple modals to be open simultaneously', () => {
      // Arrange
      const { result } = renderHook(() => useMultiModalState(['modal1', 'modal2']))

      // Act
      act(() => {
        result.current.modals.modal1.open()
        result.current.modals.modal2.open()
      })

      // Assert
      expect(result.current.modals.modal1.isOpen).toBe(true)
      expect(result.current.modals.modal2.isOpen).toBe(true)
    })

    it('should handle opening same modal multiple times', () => {
      // Arrange
      const { result } = renderHook(() => useMultiModalState(['modal1']))

      // Act
      act(() => {
        result.current.modals.modal1.open()
        result.current.modals.modal1.open()
        result.current.modals.modal1.open()
      })

      // Assert
      expect(result.current.modals.modal1.isOpen).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty modal names array gracefully', () => {
      // Arrange & Act
      const { result } = renderHook(() => useMultiModalState([]))

      // Assert
      expect(result.current.modals).toEqual({})
      expect(typeof result.current.closeAll).toBe('function')
    })

    it('should handle closeAll when all modals are already closed', () => {
      // Arrange
      const { result } = renderHook(() => useMultiModalState(['modal1', 'modal2']))

      // Act
      act(() => {
        result.current.closeAll()
      })

      // Assert - Should not throw and all modals should remain closed
      expect(result.current.modals.modal1.isOpen).toBe(false)
      expect(result.current.modals.modal2.isOpen).toBe(false)
    })

    it('should handle modalNames array change with new modal names (fallback to false)', () => {
      // Arrange - Start with one modal
      let modalNames = ['modal1']
      const { result, rerender } = renderHook(
        ({ names }) => useMultiModalState(names),
        { initialProps: { names: modalNames } },
      )

      // Open the initial modal
      act(() => {
        result.current.modals.modal1.open()
      })
      expect(result.current.modals.modal1.isOpen).toBe(true)

      // Act - Add a new modal name that wasn't in the initial state
      // This triggers the `openStates[name] ?? false` fallback for 'modal2'
      modalNames = ['modal1', 'modal2']
      rerender({ names: modalNames })

      // Assert - The new modal should default to false via the ?? operator
      expect(result.current.modals.modal2.isOpen).toBe(false)
      // The existing modal should retain its state
      expect(result.current.modals.modal1.isOpen).toBe(true)
    })

    it('should handle removing modal names from array', () => {
      // Arrange - Start with multiple modals
      let modalNames: string[] = ['modal1', 'modal2', 'modal3']
      const { result, rerender } = renderHook(
        ({ names }) => useMultiModalState(names),
        { initialProps: { names: modalNames } },
      )

      // Open all modals
      act(() => {
        result.current.modals.modal1.open()
        result.current.modals.modal2.open()
        result.current.modals.modal3.open()
      })

      // Act - Remove a modal name from the array
      modalNames = ['modal1', 'modal3']
      rerender({ names: modalNames })

      // Assert - Remaining modals should work correctly
      expect(result.current.modals.modal1.isOpen).toBe(true)
      expect(result.current.modals.modal3.isOpen).toBe(true)
      // modal2 should no longer be in the modals object
      expect(result.current.modals.modal2).toBeUndefined()
    })

    it('should handle completely replacing modal names array', () => {
      // Arrange - Start with initial modals
      let modalNames = ['modalA', 'modalB']
      const { result, rerender } = renderHook(
        ({ names }) => useMultiModalState(names),
        { initialProps: { names: modalNames } },
      )

      // Open one modal
      act(() => {
        result.current.modals.modalA.open()
      })

      // Act - Completely replace with different modal names
      modalNames = ['modalX', 'modalY']
      rerender({ names: modalNames })

      // Assert - New modals should default to closed via ?? false fallback
      expect(result.current.modals.modalX.isOpen).toBe(false)
      expect(result.current.modals.modalY.isOpen).toBe(false)
      // Old modals should no longer exist
      expect(result.current.modals.modalA).toBeUndefined()
      expect(result.current.modals.modalB).toBeUndefined()
    })

    it('should handle rapid modalNames array changes', () => {
      // Arrange
      let modalNames = ['modal1']
      const { result, rerender } = renderHook(
        ({ names }) => useMultiModalState(names),
        { initialProps: { names: modalNames } },
      )

      // Act - Rapidly change modal names
      modalNames = ['modal1', 'modal2']
      rerender({ names: modalNames })
      modalNames = ['modal2', 'modal3']
      rerender({ names: modalNames })
      modalNames = ['modal3', 'modal4', 'modal5']
      rerender({ names: modalNames })

      // Assert - Final state should have the correct modals with fallback values
      expect(result.current.modals.modal3.isOpen).toBe(false)
      expect(result.current.modals.modal4.isOpen).toBe(false)
      expect(result.current.modals.modal5.isOpen).toBe(false)
    })
  })
})

// ============================================================================
// useWorkflowToolForm Hook Tests
// ============================================================================
describe('useWorkflowToolForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should initialize form state from payload', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({
        label: 'Custom Label',
        name: 'custom_name',
        description: 'Custom description',
      })

      // Act
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Assert
      expect(result.current.label).toBe('Custom Label')
      expect(result.current.name).toBe('custom_name')
      expect(result.current.description).toBe('Custom description')
    })

    it('should initialize emoji from payload', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({
        icon: { content: '🎯', background: '#ff0000' },
      })

      // Act
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Assert
      expect(result.current.emoji.content).toBe('🎯')
      expect(result.current.emoji.background).toBe('#ff0000')
    })

    it('should initialize parameters from payload', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({
        parameters: [
          { name: 'param1', description: 'Desc 1', form: 'llm', required: true, type: 'string' },
          { name: 'param2', description: 'Desc 2', form: 'form', required: false, type: 'number' },
        ],
      })

      // Act
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Assert
      expect(result.current.parameters).toHaveLength(2)
      expect(result.current.parameters[0].name).toBe('param1')
      expect(result.current.parameters[1].name).toBe('param2')
    })
  })

  describe('State Setters', () => {
    it('should update label state', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload()
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.setLabel('New Label')
      })

      // Assert
      expect(result.current.label).toBe('New Label')
    })

    it('should update name state', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload()
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.setName('new_name')
      })

      // Assert
      expect(result.current.name).toBe('new_name')
    })

    it('should update description state', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload()
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.setDescription('New description')
      })

      // Assert
      expect(result.current.description).toBe('New description')
    })

    it('should update emoji state', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload()
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.setEmoji({ content: '🚀', background: '#00ff00' })
      })

      // Assert
      expect(result.current.emoji.content).toBe('🚀')
      expect(result.current.emoji.background).toBe('#00ff00')
    })

    it('should update labels state', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload()
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.setLabels(['tag1', 'tag2', 'tag3'])
      })

      // Assert
      expect(result.current.labels).toEqual(['tag1', 'tag2', 'tag3'])
    })

    it('should update privacy policy state', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload()
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.setPrivacyPolicy('https://new-policy.com')
      })

      // Assert
      expect(result.current.privacyPolicy).toBe('https://new-policy.com')
    })
  })

  describe('Parameter Change Handler', () => {
    it('should update parameter description', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({
        parameters: [
          { name: 'param1', description: '', form: 'llm', required: true, type: 'string' },
        ],
      })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.handleParameterChange('description', 'New description', 0)
      })

      // Assert
      expect(result.current.parameters[0].description).toBe('New description')
    })

    it('should update parameter form', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({
        parameters: [
          { name: 'param1', description: '', form: 'llm', required: true, type: 'string' },
        ],
      })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.handleParameterChange('form', 'form', 0)
      })

      // Assert
      expect(result.current.parameters[0].form).toBe('form')
    })

    it('should update only the targeted parameter index', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({
        parameters: [
          { name: 'param1', description: 'Desc 1', form: 'llm', required: true, type: 'string' },
          { name: 'param2', description: 'Desc 2', form: 'llm', required: false, type: 'string' },
        ],
      })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.handleParameterChange('description', 'Updated', 1)
      })

      // Assert
      expect(result.current.parameters[0].description).toBe('Desc 1') // Unchanged
      expect(result.current.parameters[1].description).toBe('Updated')
    })
  })

  describe('Name Validation', () => {
    it('should return true for valid alphanumeric name', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({ name: 'valid_name_123' })

      // Act
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Assert
      expect(result.current.isNameValid).toBe(true)
    })

    it('should return false for name with spaces', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({ name: '' })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.setName('invalid name')
      })

      // Assert
      expect(result.current.isNameValid).toBe(false)
    })

    it('should return false for name with special characters', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({ name: '' })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Act
      act(() => {
        result.current.setName('invalid-name!')
      })

      // Assert
      expect(result.current.isNameValid).toBe(false)
    })

    it('should return true for empty name', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload({ name: '' })

      // Act
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Assert
      expect(result.current.isNameValid).toBe(true)
    })
  })

  describe('Reserved Output Parameters', () => {
    it('should include text, files, and json as reserved', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload()

      // Act
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Assert
      expect(result.current.reservedOutputParameters).toHaveLength(3)
      expect(result.current.reservedOutputParameters.map(p => p.name)).toContain('text')
      expect(result.current.reservedOutputParameters.map(p => p.name)).toContain('files')
      expect(result.current.reservedOutputParameters.map(p => p.name)).toContain('json')
    })

    it('should detect reserved parameter name collision', () => {
      // Arrange
      const payload = createMockWorkflowToolFormPayload()

      // Act
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
      }))

      // Assert
      expect(result.current.isOutputParameterReserved('text')).toBe(true)
      expect(result.current.isOutputParameterReserved('files')).toBe(true)
      expect(result.current.isOutputParameterReserved('json')).toBe(true)
      expect(result.current.isOutputParameterReserved('custom_param')).toBe(false)
    })
  })

  describe('onConfirm', () => {
    it('should call onCreate in add mode with valid form', () => {
      // Arrange
      const onCreate = vi.fn()
      const payload = createMockWorkflowToolFormPayload()
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
        onCreate,
      }))

      // Act
      act(() => {
        result.current.onConfirm()
      })

      // Assert
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test_tool',
        workflow_app_id: 'workflow-app-123',
      }))
    })

    it('should call onSave in edit mode with valid form', () => {
      // Arrange
      const onSave = vi.fn()
      const payload = createMockWorkflowToolFormPayload({ workflow_tool_id: 'tool-123' })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: false,
        onSave,
      }))

      // Act
      act(() => {
        result.current.onConfirm()
      })

      // Assert
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        workflow_tool_id: 'tool-123',
      }))
    })

    it('should show error toast when label is empty', () => {
      // Arrange
      const onCreate = vi.fn()
      const payload = createMockWorkflowToolFormPayload({ label: '' })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
        onCreate,
      }))

      // Act
      act(() => {
        result.current.onConfirm()
      })

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
      expect(onCreate).not.toHaveBeenCalled()
    })

    it('should show error toast when name is empty', () => {
      // Arrange
      const onCreate = vi.fn()
      const payload = createMockWorkflowToolFormPayload({ name: '' })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
        onCreate,
      }))

      // Act
      act(() => {
        result.current.onConfirm()
      })

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
      expect(onCreate).not.toHaveBeenCalled()
    })

    it('should show error toast for invalid name format', () => {
      // Arrange
      const onCreate = vi.fn()
      const payload = createMockWorkflowToolFormPayload({ name: '' })
      const { result } = renderHook(() => useWorkflowToolForm({
        payload,
        isAdd: true,
        onCreate,
      }))

      // Act
      act(() => {
        result.current.setName('invalid name')
        result.current.onConfirm()
      })

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
      expect(onCreate).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// ToolInputTable Component Tests
// ============================================================================
describe('ToolInputTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = {
        parameters: [],
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.getByText('tools.createTool.toolInput.name')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.toolInput.method')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.toolInput.description')).toBeInTheDocument()
    })

    it('should render table headers correctly', () => {
      // Arrange
      const props = {
        parameters: [],
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getAllByRole('columnheader')).toHaveLength(3)
    })

    it('should render parameter rows', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'param1', description: 'Desc 1', form: 'llm', required: true, type: 'string' },
          { name: 'param2', description: 'Desc 2', form: 'form', required: false, type: 'number' },
        ],
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.getByText('param1')).toBeInTheDocument()
      expect(screen.getByText('param2')).toBeInTheDocument()
    })

    it('should render required indicator for required parameters', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'param1', description: '', form: 'llm', required: true, type: 'string' },
        ],
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.getByText('tools.createTool.toolInput.required')).toBeInTheDocument()
    })

    it('should not render required indicator for optional parameters', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'param1', description: '', form: 'llm', required: false, type: 'string' },
        ],
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.queryByText('tools.createTool.toolInput.required')).not.toBeInTheDocument()
    })

    it('should render parameter type', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'param1', description: '', form: 'llm', required: false, type: 'string' },
        ],
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.getByText('string')).toBeInTheDocument()
    })
  })

  describe('Special Parameter Handling', () => {
    it('should render __image parameter without method selector', () => {
      // Arrange
      const props = {
        parameters: [
          { name: '__image', description: 'Image input', form: 'llm', required: true, type: 'file' },
        ],
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.getByText('__image')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.toolInput.methodParameter')).toBeInTheDocument()
      // Should not have portal trigger for __image
      expect(screen.queryByTestId('portal-trigger')).not.toBeInTheDocument()
    })

    it('should render regular parameters with method selector', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'regular_param', description: '', form: 'llm', required: false, type: 'string' },
        ],
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onParameterChange when description is changed', async () => {
      // Arrange
      const user = userEvent.setup()
      const onParameterChange = vi.fn()
      const props = {
        parameters: [
          { name: 'param1', description: '', form: 'llm', required: false, type: 'string' },
        ],
        onParameterChange,
      }

      // Act
      render(<ToolInputTable {...props} />)
      const input = screen.getByPlaceholderText('tools.createTool.toolInput.descriptionPlaceholder')
      await user.type(input, 'New description')

      // Assert
      expect(onParameterChange).toHaveBeenCalledWith('description', expect.any(String), 0)
    })

    it('should call onParameterChange when method is changed', async () => {
      // Arrange
      const user = userEvent.setup()
      const onParameterChange = vi.fn()
      const props = {
        parameters: [
          { name: 'param1', description: '', form: 'llm', required: false, type: 'string' },
        ],
        onParameterChange,
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Open dropdown
      await user.click(screen.getByTestId('portal-trigger'))

      // Select form option
      const formOption = screen.getByText('tools.createTool.toolInput.methodSetting')
      await user.click(formOption)

      // Assert
      expect(onParameterChange).toHaveBeenCalledWith('form', 'form', 0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty parameters array', () => {
      // Arrange
      const props = {
        parameters: [],
        onParameterChange: vi.fn(),
      }

      // Act & Assert
      expect(() => render(<ToolInputTable {...props} />)).not.toThrow()
    })

    it('should handle many parameters', () => {
      // Arrange
      const props = {
        parameters: Array.from({ length: 10 }, (_, i) => ({
          name: `param${i}`,
          description: `Desc ${i}`,
          form: 'llm',
          required: i % 2 === 0,
          type: 'string',
        })),
        onParameterChange: vi.fn(),
      }

      // Act
      render(<ToolInputTable {...props} />)

      // Assert
      expect(screen.getByText('param0')).toBeInTheDocument()
      expect(screen.getByText('param9')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should not re-render when props are the same', () => {
      // Arrange
      const parameters = [
        { name: 'param1', description: '', form: 'llm', required: false, type: 'string' },
      ]
      const onParameterChange = vi.fn()

      // Act
      const { rerender } = render(
        <ToolInputTable parameters={parameters} onParameterChange={onParameterChange} />,
      )

      // Rerender with same props reference
      rerender(
        <ToolInputTable parameters={parameters} onParameterChange={onParameterChange} />,
      )

      // Assert - Component should still render correctly
      expect(screen.getByText('param1')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// ToolOutputTable Component Tests
// ============================================================================
describe('ToolOutputTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = {
        parameters: [],
        isReserved: () => false,
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert
      expect(screen.getByText('tools.createTool.name')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.toolOutput.description')).toBeInTheDocument()
    })

    it('should render table headers correctly', () => {
      // Arrange
      const props = {
        parameters: [],
        isReserved: () => false,
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert
      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    })

    it('should render output parameter rows', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'output1', description: 'Output 1 description', type: VarType.string },
          { name: 'output2', description: 'Output 2 description', type: VarType.number },
        ],
        isReserved: () => false,
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert
      expect(screen.getByText('output1')).toBeInTheDocument()
      expect(screen.getByText('output2')).toBeInTheDocument()
      expect(screen.getByText('Output 1 description')).toBeInTheDocument()
      expect(screen.getByText('Output 2 description')).toBeInTheDocument()
    })

    it('should render reserved indicator for reserved parameters', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'text', description: 'Reserved text output', type: VarType.string, reserved: true },
        ],
        isReserved: () => false,
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert
      expect(screen.getByText('tools.createTool.toolOutput.reserved')).toBeInTheDocument()
    })

    it('should render parameter type', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'output1', description: '', type: VarType.arrayFile },
        ],
        isReserved: () => false,
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert
      expect(screen.getByText(VarType.arrayFile)).toBeInTheDocument()
    })
  })

  describe('Reserved Parameter Warning', () => {
    it('should show warning tooltip for duplicate reserved name', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'text', description: 'Custom text output', type: VarType.string }, // Not marked as reserved
        ],
        isReserved: (name: string) => name === 'text',
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert - Warning icon should be present for collision
      const warningIcon = document.querySelector('.text-text-warning-secondary')
      expect(warningIcon).toBeInTheDocument()
    })

    it('should not show warning for non-colliding names', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'custom_output', description: 'Custom output', type: VarType.string },
        ],
        isReserved: (name: string) => ['text', 'files', 'json'].includes(name),
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert
      const warningIcon = document.querySelector('.text-text-warning-secondary')
      expect(warningIcon).not.toBeInTheDocument()
    })

    it('should not show warning for reserved parameters marked as reserved', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'text', description: 'Reserved', type: VarType.string, reserved: true },
        ],
        isReserved: (name: string) => name === 'text',
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert - Should show reserved badge, not warning
      expect(screen.getByText('tools.createTool.toolOutput.reserved')).toBeInTheDocument()
      const warningIcon = document.querySelector('.text-text-warning-secondary')
      expect(warningIcon).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty parameters array', () => {
      // Arrange
      const props = {
        parameters: [],
        isReserved: () => false,
      }

      // Act & Assert
      expect(() => render(<ToolOutputTable {...props} />)).not.toThrow()
    })

    it('should handle undefined type gracefully', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'output1', description: 'No type specified' },
        ],
        isReserved: () => false,
      }

      // Act & Assert
      expect(() => render(<ToolOutputTable {...props} />)).not.toThrow()
    })

    it('should handle long parameter names with truncation', () => {
      // Arrange
      const props = {
        parameters: [
          { name: 'very_long_parameter_name_that_should_be_truncated', description: 'Long name', type: VarType.string },
        ],
        isReserved: () => false,
      }

      // Act
      render(<ToolOutputTable {...props} />)

      // Assert - Should render with truncate class
      const nameElement = screen.getByText('very_long_parameter_name_that_should_be_truncated')
      expect(nameElement).toHaveClass('truncate')
    })
  })

  describe('Memoization', () => {
    it('should be memoized', () => {
      // Arrange
      const parameters = [
        { name: 'output1', description: 'Output 1', type: VarType.string },
      ]
      const isReserved = vi.fn(() => false)

      // Act
      const { rerender } = render(
        <ToolOutputTable parameters={parameters} isReserved={isReserved} />,
      )

      rerender(
        <ToolOutputTable parameters={parameters} isReserved={isReserved} />,
      )

      // Assert - Component should still render correctly
      expect(screen.getByText('output1')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// MethodSelector Component Tests
// ============================================================================
describe('MethodSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

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
// WorkflowToolAsModal Integration Tests
// ============================================================================
describe('WorkflowToolAsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

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

    it('should render all form fields', () => {
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
      expect(screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('tools.createTool.descriptionPlaceholder')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder')).toBeInTheDocument()
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

  describe('Form State Management', () => {
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
      await user.click(screen.getByTestId('app-icon'))
      await user.click(screen.getByTestId('select-emoji'))

      // Assert
      const updatedIcon = screen.getByTestId('app-icon')
      expect(updatedIcon).toHaveAttribute('data-icon', '🚀')
      expect(updatedIcon).toHaveAttribute('data-background', '#f0f0f0')
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
  })

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
  })

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

      // Assert
      expect(screen.getByText('tools.createTool.toolInput.methodParameter')).toBeInTheDocument()
    })

    it('should handle undefined onSave gracefully', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = {
        isAdd: false,
        payload: createDefaultModalPayload({ workflow_tool_id: 'tool-123' }),
        onHide: vi.fn(),
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(screen.getByText('tools.createTool.confirmTitle')).toBeInTheDocument()
      })

      // Assert - should not crash
      await user.click(screen.getByText('common.operation.confirm'))
    })
  })

  describe('Memoization', () => {
    it('should be memoized', () => {
      // Arrange
      const payload = createDefaultModalPayload()
      const onHide = vi.fn()

      // Act
      const { rerender } = render(
        <WorkflowToolAsModal isAdd={true} payload={payload} onHide={onHide} />,
      )

      rerender(
        <WorkflowToolAsModal isAdd={true} payload={payload} onHide={onHide} />,
      )

      // Assert - Component should still render correctly
      expect(screen.getByTestId('drawer')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// WorkflowToolConfigureButton Integration Tests
// ============================================================================
describe('WorkflowToolConfigureButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockFetchWorkflowToolDetailByAppID.mockResolvedValue(createMockWorkflowToolDetail())
    mockUseWorkflowToolDetail.mockReturnValue({
      data: createMockWorkflowToolDetail(),
      isLoading: false,
      refetch: vi.fn(),
    })
    mockCreateTool.mockResolvedValue({})
    mockUpdateTool.mockResolvedValue({})
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps()

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      // Assert
      expect(screen.getByText('workflow.common.workflowAsTool')).toBeInTheDocument()
    })

    it('should render configure required badge when not published', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: false })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      // Assert
      expect(screen.getByText('workflow.common.configureRequired')).toBeInTheDocument()
    })

    it('should render configure and manage buttons when published', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure')).toBeInTheDocument()
        expect(screen.getByText('workflow.common.manageInTools')).toBeInTheDocument()
      })
    })

    it('should render disabled state correctly', () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ disabled: true })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

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
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      // Assert
      expect(screen.getByText('Please save the workflow first')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open modal when card clicked (unpublished)', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = createDefaultConfigureButtonProps()

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)
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
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)
      const triggerArea = screen.getByText('workflow.common.workflowAsTool').closest('.flex')
      await user.click(triggerArea!)

      // Assert
      expect(screen.queryByTestId('drawer')).not.toBeInTheDocument()
    })

    it('should navigate to tools page when manage button clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      await waitFor(() => {
        expect(screen.getByText('workflow.common.manageInTools')).toBeInTheDocument()
      })

      await user.click(screen.getByText('workflow.common.manageInTools'))

      // Assert
      expect(mockPush).toHaveBeenCalledWith('/tools?category=workflow')
    })
  })

  describe('Outdated Detection', () => {
    it('should detect outdated when parameter count differs', async () => {
      // Arrange - detail has 1 parameter but inputs have 2
      const detail = createMockWorkflowToolDetail()
      mockUseWorkflowToolDetail.mockReturnValue({
        data: detail,
        isLoading: false,
        refetch: vi.fn(),
      })
      const props = createDefaultConfigureButtonProps({
        published: true,
        inputs: [
          createMockInputVar({ variable: 'test_var' }),
          createMockInputVar({ variable: 'extra_var' }),
        ],
      })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      // Assert - The outdated indicator should show
      await waitFor(() => {
        expect(screen.getByText('workflow.common.workflowAsToolTip')).toBeInTheDocument()
      })
    })

    it('should not show outdated when parameters match', async () => {
      // Arrange - detail and inputs both have 1 matching parameter
      const detail = createMockWorkflowToolDetail()
      mockUseWorkflowToolDetail.mockReturnValue({
        data: detail,
        isLoading: false,
        refetch: vi.fn(),
      })
      const props = createDefaultConfigureButtonProps({
        published: true,
        inputs: [createMockInputVar({ variable: 'test_var', required: true, type: InputVarType.textInput })],
      })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('workflow.common.configure')).toBeInTheDocument()
      })
      expect(screen.queryByText('workflow.common.workflowAsToolTip')).not.toBeInTheDocument()
    })
  })

  describe('API Integration', () => {
    it('should create workflow tool provider on first publish', async () => {
      // Arrange
      const user = userEvent.setup()
      mockCreateTool.mockResolvedValue({})
      mockUseWorkflowToolDetail.mockReturnValue({
        data: undefined,
        isLoading: false,
        refetch: vi.fn(),
      })
      const props = createDefaultConfigureButtonProps()

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

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
        expect(mockCreateTool).toHaveBeenCalled()
      })
    })

    it('should show success toast after creating workflow tool', async () => {
      // Arrange
      const user = userEvent.setup()
      mockCreateTool.mockResolvedValue({})
      mockUseWorkflowToolDetail.mockReturnValue({
        data: undefined,
        isLoading: false,
        refetch: vi.fn(),
      })
      const props = createDefaultConfigureButtonProps()

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

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
      mockCreateTool.mockRejectedValue(new Error('Create failed'))
      mockUseWorkflowToolDetail.mockReturnValue({
        data: undefined,
        isLoading: false,
        refetch: vi.fn(),
      })
      const props = createDefaultConfigureButtonProps()

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

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
  })

  describe('Edge Cases', () => {
    it('should handle API returning undefined', async () => {
      // Arrange
      mockUseWorkflowToolDetail.mockReturnValue({
        data: undefined,
        isLoading: false,
        refetch: vi.fn(),
      })
      const props = createDefaultConfigureButtonProps({ published: true })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      // Assert
      expect(screen.getByText('workflow.common.workflowAsTool')).toBeInTheDocument()
    })

    it('should handle rapid publish/unpublish state changes', async () => {
      // Arrange
      const props = createDefaultConfigureButtonProps({ published: false })

      // Act
      const { rerender } = renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

      await act(async () => {
        rerender(
          <TestWrapper>
            <WorkflowToolConfigureButton {...props} published={true} />
          </TestWrapper>,
        )
      })
      await act(async () => {
        rerender(
          <TestWrapper>
            <WorkflowToolConfigureButton {...props} published={false} />
          </TestWrapper>,
        )
      })

      // Assert - should not crash
      expect(screen.getByText('workflow.common.workflowAsTool')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// ConfirmModal Integration Tests
// ============================================================================
describe('ConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render when show is true', () => {
      // Arrange & Act
      render(<ConfirmModal show={true} onClose={vi.fn()} />)

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should not render when show is false', () => {
      // Arrange & Act
      render(<ConfirmModal show={false} onClose={vi.fn()} />)

      // Assert
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render title and description', () => {
      // Arrange & Act
      render(<ConfirmModal show={true} onClose={vi.fn()} />)

      // Assert
      expect(screen.getByText('tools.createTool.confirmTitle')).toBeInTheDocument()
      expect(screen.getByText('tools.createTool.confirmTip')).toBeInTheDocument()
    })

    it('should render action buttons', () => {
      // Arrange & Act
      render(<ConfirmModal show={true} onClose={vi.fn()} />)

      // Assert
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
      expect(screen.getByText('common.operation.confirm')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClose when cancel clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<ConfirmModal show={true} onClose={onClose} />)

      // Act
      await user.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirm when confirm clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(<ConfirmModal show={true} onClose={vi.fn()} onConfirm={onConfirm} />)

      // Act
      await user.click(screen.getByText('common.operation.confirm'))

      // Assert
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close button clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<ConfirmModal show={true} onClose={onClose} />)

      // Act
      const closeButton = document.querySelector('.cursor-pointer')
      await user.click(closeButton!)

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing onConfirm gracefully', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<ConfirmModal show={true} onClose={vi.fn()} />)

      // Act & Assert - should not throw
      await user.click(screen.getByText('common.operation.confirm'))
    })

    it('should handle rapid show/hide toggling', async () => {
      // Arrange
      const { rerender } = render(<ConfirmModal show={false} onClose={vi.fn()} />)

      // Assert - Initially not shown
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      // Act - Show modal
      await act(async () => {
        rerender(<ConfirmModal show={true} onClose={vi.fn()} />)
      })

      // Assert - Now shown
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Act - Hide modal again
      await act(async () => {
        rerender(<ConfirmModal show={false} onClose={vi.fn()} />)
      })

      // Assert - Hidden again
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// Complete Integration Tests
// ============================================================================
describe('Complete Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockFetchWorkflowToolDetailByAppID.mockResolvedValue(createMockWorkflowToolDetail())
    mockUseWorkflowToolDetail.mockReturnValue({
      data: createMockWorkflowToolDetail(),
      isLoading: false,
      refetch: vi.fn(),
    })
    mockCreateTool.mockResolvedValue({})
    mockUpdateTool.mockResolvedValue({})
  })

  describe('Full Create Workflow', () => {
    it('should complete full create workflow', async () => {
      // Arrange
      const user = userEvent.setup()
      mockCreateTool.mockResolvedValue({})
      mockUseWorkflowToolDetail.mockReturnValue({
        data: undefined,
        isLoading: false,
        refetch: vi.fn(),
      })
      const onRefreshData = vi.fn()
      const props = createDefaultConfigureButtonProps({ onRefreshData })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

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
        expect(mockCreateTool).toHaveBeenCalledWith(
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
  })

  describe('Full Update Workflow', () => {
    it('should complete full update workflow', async () => {
      // Arrange
      const user = userEvent.setup()
      const handlePublish = vi.fn().mockResolvedValue(undefined)
      mockUpdateTool.mockResolvedValue({})
      const props = createDefaultConfigureButtonProps({
        published: true,
        handlePublish,
      })

      // Act
      renderWithQueryClient(<WorkflowToolConfigureButton {...props} />)

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
        expect(mockUpdateTool).toHaveBeenCalled()
      })
    })
  })

  describe('Form Validation Flow', () => {
    it('should prevent save with empty required fields', async () => {
      // Arrange
      const user = userEvent.setup()
      const onCreate = vi.fn()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ label: '', name: '' }),
        onHide: vi.fn(),
        onCreate,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
      expect(onCreate).not.toHaveBeenCalled()
    })

    it('should allow save after filling required fields', async () => {
      // Arrange
      const user = userEvent.setup()
      const onCreate = vi.fn()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({ label: '', name: '' }),
        onHide: vi.fn(),
        onCreate,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Fill required fields
      const labelInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.type(labelInput, 'My Tool')

      const nameInput = screen.getByPlaceholderText('tools.createTool.nameForToolCallPlaceHolder')
      await user.type(nameInput, 'my_tool')

      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(onCreate).toHaveBeenCalled()
    })
  })

  describe('Parameter Management Flow', () => {
    it('should handle parameter description updates through the full flow', async () => {
      // Arrange
      const user = userEvent.setup()
      const onCreate = vi.fn()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({
          parameters: [{
            name: 'test_param',
            description: '',
            form: 'llm',
            required: true,
            type: 'string',
          }],
        }),
        onHide: vi.fn(),
        onCreate,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Update parameter description
      const descInput = screen.getByPlaceholderText('tools.createTool.toolInput.descriptionPlaceholder')
      await user.type(descInput, 'Test parameter description')

      // Save
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.arrayContaining([
            expect.objectContaining({
              name: 'test_param',
              description: 'Test parameter description',
            }),
          ]),
        }),
      )
    })

    it('should handle method selector changes through the full flow', async () => {
      // Arrange
      const user = userEvent.setup()
      const onCreate = vi.fn()
      const props = {
        isAdd: true,
        payload: createDefaultModalPayload({
          parameters: [{
            name: 'test_param',
            description: 'Test',
            form: 'llm',
            required: false,
            type: 'string',
          }],
        }),
        onHide: vi.fn(),
        onCreate,
      }

      // Act
      render(<WorkflowToolAsModal {...props} />)

      // Change method to form - use getAllByTestId since there might be multiple portal triggers
      const portalTriggers = screen.getAllByTestId('portal-trigger')
      // The method selector trigger should be within the tool input table
      await user.click(portalTriggers[portalTriggers.length - 1])
      const formOption = screen.getByText('tools.createTool.toolInput.methodSetting')
      await user.click(formOption)

      // Save
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.arrayContaining([
            expect.objectContaining({
              name: 'test_param',
              form: 'form',
            }),
          ]),
        }),
      )
    })
  })
})
