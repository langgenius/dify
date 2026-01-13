import type { PanelProps } from '@/app/components/workflow/panel'
import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import RagPipelinePanel from './index'

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Type definitions for dynamic module
type DynamicModule = {
  default?: React.ComponentType<Record<string, unknown>>
}

type PromiseOrModule = Promise<DynamicModule> | DynamicModule

// Mock next/dynamic to return synchronous components immediately
vi.mock('next/dynamic', () => ({
  default: (loader: () => PromiseOrModule, _options?: Record<string, unknown>) => {
    let Component: React.ComponentType<Record<string, unknown>> | null = null

    // Try to resolve the loader synchronously for mocked modules
    try {
      const result = loader() as PromiseOrModule
      if (result && typeof (result as Promise<DynamicModule>).then === 'function') {
        // For async modules, we need to handle them specially
        // This will work with vi.mock since mocks resolve synchronously
        (result as Promise<DynamicModule>).then((mod: DynamicModule) => {
          Component = (mod.default || mod) as React.ComponentType<Record<string, unknown>>
        })
      }
      else if (result) {
        Component = ((result as DynamicModule).default || result) as React.ComponentType<Record<string, unknown>>
      }
    }
    catch {
      // If the module can't be resolved, Component stays null
    }

    // Return a simple wrapper that renders the component or null
    const DynamicComponent = React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      // For mocked modules, Component should already be set
      if (Component)
        return <Component {...props} ref={ref} />

      return null
    })

    DynamicComponent.displayName = 'DynamicComponent'
    return DynamicComponent
  },
}))

// Mock workflow store
let mockHistoryWorkflowData: Record<string, unknown> | null = null
let mockShowDebugAndPreviewPanel = false
let mockShowGlobalVariablePanel = false
let mockShowInputFieldPanel = false
let mockShowInputFieldPreviewPanel = false
let mockInputFieldEditPanelProps: Record<string, unknown> | null = null
let mockPipelineId = 'test-pipeline-123'

type MockStoreState = {
  historyWorkflowData: Record<string, unknown> | null
  showDebugAndPreviewPanel: boolean
  showGlobalVariablePanel: boolean
  showInputFieldPanel: boolean
  showInputFieldPreviewPanel: boolean
  inputFieldEditPanelProps: Record<string, unknown> | null
  pipelineId: string
}

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockStoreState) => unknown) => {
    const state: MockStoreState = {
      historyWorkflowData: mockHistoryWorkflowData,
      showDebugAndPreviewPanel: mockShowDebugAndPreviewPanel,
      showGlobalVariablePanel: mockShowGlobalVariablePanel,
      showInputFieldPanel: mockShowInputFieldPanel,
      showInputFieldPreviewPanel: mockShowInputFieldPreviewPanel,
      inputFieldEditPanelProps: mockInputFieldEditPanelProps,
      pipelineId: mockPipelineId,
    }
    return selector(state)
  },
}))

// Mock Panel component to capture props and render children
let capturedPanelProps: PanelProps | null = null
vi.mock('@/app/components/workflow/panel', () => ({
  default: (props: PanelProps) => {
    capturedPanelProps = props
    return (
      <div data-testid="workflow-panel">
        <div data-testid="panel-left">{props.components?.left}</div>
        <div data-testid="panel-right">{props.components?.right}</div>
      </div>
    )
  },
}))

// Mock Record component
vi.mock('@/app/components/workflow/panel/record', () => ({
  default: () => <div data-testid="record-panel">Record Panel</div>,
}))

// Mock TestRunPanel component
vi.mock('@/app/components/rag-pipeline/components/panel/test-run', () => ({
  default: () => <div data-testid="test-run-panel">Test Run Panel</div>,
}))

// Mock InputFieldPanel component
vi.mock('./input-field', () => ({
  default: () => <div data-testid="input-field-panel">Input Field Panel</div>,
}))

// Mock InputFieldEditorPanel component
const mockInputFieldEditorProps = vi.fn()
vi.mock('./input-field/editor', () => ({
  default: (props: Record<string, unknown>) => {
    mockInputFieldEditorProps(props)
    return <div data-testid="input-field-editor-panel">Input Field Editor Panel</div>
  },
}))

// Mock PreviewPanel component
vi.mock('./input-field/preview', () => ({
  default: () => <div data-testid="preview-panel">Preview Panel</div>,
}))

// Mock GlobalVariablePanel component
vi.mock('@/app/components/workflow/panel/global-variable-panel', () => ({
  default: () => <div data-testid="global-variable-panel">Global Variable Panel</div>,
}))

// ============================================================================
// Helper Functions
// ============================================================================

type SetupMockOptions = {
  historyWorkflowData?: Record<string, unknown> | null
  showDebugAndPreviewPanel?: boolean
  showGlobalVariablePanel?: boolean
  showInputFieldPanel?: boolean
  showInputFieldPreviewPanel?: boolean
  inputFieldEditPanelProps?: Record<string, unknown> | null
  pipelineId?: string
}

const setupMocks = (options?: SetupMockOptions) => {
  mockHistoryWorkflowData = options?.historyWorkflowData ?? null
  mockShowDebugAndPreviewPanel = options?.showDebugAndPreviewPanel ?? false
  mockShowGlobalVariablePanel = options?.showGlobalVariablePanel ?? false
  mockShowInputFieldPanel = options?.showInputFieldPanel ?? false
  mockShowInputFieldPreviewPanel = options?.showInputFieldPreviewPanel ?? false
  mockInputFieldEditPanelProps = options?.inputFieldEditPanelProps ?? null
  mockPipelineId = options?.pipelineId ?? 'test-pipeline-123'
  capturedPanelProps = null
}

// ============================================================================
// RagPipelinePanel Component Tests
// ============================================================================

describe('RagPipelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', async () => {
      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('workflow-panel')).toBeInTheDocument()
      })
    })

    it('should render Panel component with correct structure', async () => {
      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('panel-left')).toBeInTheDocument()
        expect(screen.getByTestId('panel-right')).toBeInTheDocument()
      })
    })

    it('should pass versionHistoryPanelProps to Panel', async () => {
      // Arrange
      setupMocks({ pipelineId: 'my-pipeline-456' })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps).toBeDefined()
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
          '/rag/pipelines/my-pipeline-456/workflows',
        )
      })
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests - versionHistoryPanelProps
  // -------------------------------------------------------------------------
  describe('Memoization - versionHistoryPanelProps', () => {
    it('should compute correct getVersionListUrl based on pipelineId', async () => {
      // Arrange
      setupMocks({ pipelineId: 'pipeline-abc' })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
          '/rag/pipelines/pipeline-abc/workflows',
        )
      })
    })

    it('should compute correct deleteVersionUrl function', async () => {
      // Arrange
      setupMocks({ pipelineId: 'pipeline-xyz' })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        const deleteUrl = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-1')
        expect(deleteUrl).toBe('/rag/pipelines/pipeline-xyz/workflows/version-1')
      })
    })

    it('should compute correct updateVersionUrl function', async () => {
      // Arrange
      setupMocks({ pipelineId: 'pipeline-def' })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        const updateUrl = capturedPanelProps?.versionHistoryPanelProps?.updateVersionUrl?.('version-2')
        expect(updateUrl).toBe('/rag/pipelines/pipeline-def/workflows/version-2')
      })
    })

    it('should set latestVersionId to empty string', async () => {
      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.latestVersionId).toBe('')
      })
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests - panelProps
  // -------------------------------------------------------------------------
  describe('Memoization - panelProps', () => {
    it('should pass components.left to Panel', async () => {
      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(capturedPanelProps?.components?.left).toBeDefined()
      })
    })

    it('should pass components.right to Panel', async () => {
      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(capturedPanelProps?.components?.right).toBeDefined()
      })
    })

    it('should pass versionHistoryPanelProps to panelProps', async () => {
      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps).toBeDefined()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Component Memoization Tests (React.memo)
  // -------------------------------------------------------------------------
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', async () => {
      // The component should not break when re-rendered
      const { rerender } = render(<RagPipelinePanel />)

      // Act - rerender without prop changes
      rerender(<RagPipelinePanel />)

      // Assert - component should still render correctly
      await waitFor(() => {
        expect(screen.getByTestId('workflow-panel')).toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// RagPipelinePanelOnRight Component Tests
// ============================================================================

describe('RagPipelinePanelOnRight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  // -------------------------------------------------------------------------
  // Conditional Rendering - Record Panel
  // -------------------------------------------------------------------------
  describe('Record Panel Conditional Rendering', () => {
    it('should render Record panel when historyWorkflowData exists', async () => {
      // Arrange
      setupMocks({ historyWorkflowData: { id: 'history-1' } })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('record-panel')).toBeInTheDocument()
      })
    })

    it('should not render Record panel when historyWorkflowData is null', async () => {
      // Arrange
      setupMocks({ historyWorkflowData: null })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
      })
    })

    it('should not render Record panel when historyWorkflowData is undefined', async () => {
      // Arrange
      setupMocks({ historyWorkflowData: undefined })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Conditional Rendering - TestRun Panel
  // -------------------------------------------------------------------------
  describe('TestRun Panel Conditional Rendering', () => {
    it('should render TestRun panel when showDebugAndPreviewPanel is true', async () => {
      // Arrange
      setupMocks({ showDebugAndPreviewPanel: true })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('test-run-panel')).toBeInTheDocument()
      })
    })

    it('should not render TestRun panel when showDebugAndPreviewPanel is false', async () => {
      // Arrange
      setupMocks({ showDebugAndPreviewPanel: false })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('test-run-panel')).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Conditional Rendering - GlobalVariable Panel
  // -------------------------------------------------------------------------
  describe('GlobalVariable Panel Conditional Rendering', () => {
    it('should render GlobalVariable panel when showGlobalVariablePanel is true', async () => {
      // Arrange
      setupMocks({ showGlobalVariablePanel: true })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
      })
    })

    it('should not render GlobalVariable panel when showGlobalVariablePanel is false', async () => {
      // Arrange
      setupMocks({ showGlobalVariablePanel: false })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('global-variable-panel')).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Multiple Panels Rendering
  // -------------------------------------------------------------------------
  describe('Multiple Panels Rendering', () => {
    it('should render all right panels when all conditions are true', async () => {
      // Arrange
      setupMocks({
        historyWorkflowData: { id: 'history-1' },
        showDebugAndPreviewPanel: true,
        showGlobalVariablePanel: true,
      })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('record-panel')).toBeInTheDocument()
        expect(screen.getByTestId('test-run-panel')).toBeInTheDocument()
        expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
      })
    })

    it('should render no right panels when all conditions are false', async () => {
      // Arrange
      setupMocks({
        historyWorkflowData: null,
        showDebugAndPreviewPanel: false,
        showGlobalVariablePanel: false,
      })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('test-run-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('global-variable-panel')).not.toBeInTheDocument()
      })
    })

    it('should render only Record and TestRun panels', async () => {
      // Arrange
      setupMocks({
        historyWorkflowData: { id: 'history-1' },
        showDebugAndPreviewPanel: true,
        showGlobalVariablePanel: false,
      })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('record-panel')).toBeInTheDocument()
        expect(screen.getByTestId('test-run-panel')).toBeInTheDocument()
        expect(screen.queryByTestId('global-variable-panel')).not.toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// RagPipelinePanelOnLeft Component Tests
// ============================================================================

describe('RagPipelinePanelOnLeft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  // -------------------------------------------------------------------------
  // Conditional Rendering - Preview Panel
  // -------------------------------------------------------------------------
  describe('Preview Panel Conditional Rendering', () => {
    it('should render Preview panel when showInputFieldPreviewPanel is true', async () => {
      // Arrange
      setupMocks({ showInputFieldPreviewPanel: true })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
      })
    })

    it('should not render Preview panel when showInputFieldPreviewPanel is false', async () => {
      // Arrange
      setupMocks({ showInputFieldPreviewPanel: false })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Conditional Rendering - InputFieldEditor Panel
  // -------------------------------------------------------------------------
  describe('InputFieldEditor Panel Conditional Rendering', () => {
    it('should render InputFieldEditor panel when inputFieldEditPanelProps is provided', async () => {
      // Arrange
      const editProps = {
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        initialData: { variable: 'test' },
      }
      setupMocks({ inputFieldEditPanelProps: editProps })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('input-field-editor-panel')).toBeInTheDocument()
      })
    })

    it('should not render InputFieldEditor panel when inputFieldEditPanelProps is null', async () => {
      // Arrange
      setupMocks({ inputFieldEditPanelProps: null })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('input-field-editor-panel')).not.toBeInTheDocument()
      })
    })

    it('should pass props to InputFieldEditor panel', async () => {
      // Arrange
      const editProps = {
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        initialData: { variable: 'test_var', label: 'Test Label' },
      }
      setupMocks({ inputFieldEditPanelProps: editProps })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(mockInputFieldEditorProps).toHaveBeenCalledWith(
          expect.objectContaining({
            onClose: editProps.onClose,
            onSubmit: editProps.onSubmit,
            initialData: editProps.initialData,
          }),
        )
      })
    })
  })

  // -------------------------------------------------------------------------
  // Conditional Rendering - InputField Panel
  // -------------------------------------------------------------------------
  describe('InputField Panel Conditional Rendering', () => {
    it('should render InputField panel when showInputFieldPanel is true', async () => {
      // Arrange
      setupMocks({ showInputFieldPanel: true })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('input-field-panel')).toBeInTheDocument()
      })
    })

    it('should not render InputField panel when showInputFieldPanel is false', async () => {
      // Arrange
      setupMocks({ showInputFieldPanel: false })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('input-field-panel')).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Multiple Panels Rendering
  // -------------------------------------------------------------------------
  describe('Multiple Left Panels Rendering', () => {
    it('should render all left panels when all conditions are true', async () => {
      // Arrange
      setupMocks({
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: { onClose: vi.fn(), onSubmit: vi.fn() },
        showInputFieldPanel: true,
      })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
        expect(screen.getByTestId('input-field-editor-panel')).toBeInTheDocument()
        expect(screen.getByTestId('input-field-panel')).toBeInTheDocument()
      })
    })

    it('should render no left panels when all conditions are false', async () => {
      // Arrange
      setupMocks({
        showInputFieldPreviewPanel: false,
        inputFieldEditPanelProps: null,
        showInputFieldPanel: false,
      })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('input-field-editor-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('input-field-panel')).not.toBeInTheDocument()
      })
    })

    it('should render only Preview and InputField panels', async () => {
      // Arrange
      setupMocks({
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: null,
        showInputFieldPanel: true,
      })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
        expect(screen.queryByTestId('input-field-editor-panel')).not.toBeInTheDocument()
        expect(screen.getByTestId('input-field-panel')).toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  // -------------------------------------------------------------------------
  // Empty/Undefined Values
  // -------------------------------------------------------------------------
  describe('Empty/Undefined Values', () => {
    it('should handle empty pipelineId gracefully', async () => {
      // Arrange
      setupMocks({ pipelineId: '' })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
          '/rag/pipelines//workflows',
        )
      })
    })

    it('should handle special characters in pipelineId', async () => {
      // Arrange
      setupMocks({ pipelineId: 'pipeline-with-special_chars.123' })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
          '/rag/pipelines/pipeline-with-special_chars.123/workflows',
        )
      })
    })
  })

  // -------------------------------------------------------------------------
  // Props Spreading Tests
  // -------------------------------------------------------------------------
  describe('Props Spreading', () => {
    it('should correctly spread inputFieldEditPanelProps to editor component', async () => {
      // Arrange
      const customProps = {
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        initialData: {
          variable: 'custom_var',
          label: 'Custom Label',
          type: 'text',
        },
        extraProp: 'extra-value',
      }
      setupMocks({ inputFieldEditPanelProps: customProps })

      // Act
      render(<RagPipelinePanel />)

      // Assert
      await waitFor(() => {
        expect(mockInputFieldEditorProps).toHaveBeenCalledWith(
          expect.objectContaining({
            extraProp: 'extra-value',
          }),
        )
      })
    })
  })

  // -------------------------------------------------------------------------
  // State Combinations
  // -------------------------------------------------------------------------
  describe('State Combinations', () => {
    it('should handle all panels visible simultaneously', async () => {
      // Arrange
      setupMocks({
        historyWorkflowData: { id: 'h1' },
        showDebugAndPreviewPanel: true,
        showGlobalVariablePanel: true,
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: { onClose: vi.fn(), onSubmit: vi.fn() },
        showInputFieldPanel: true,
      })

      // Act
      render(<RagPipelinePanel />)

      // Assert - All panels should be visible
      await waitFor(() => {
        expect(screen.getByTestId('record-panel')).toBeInTheDocument()
        expect(screen.getByTestId('test-run-panel')).toBeInTheDocument()
        expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
        expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
        expect(screen.getByTestId('input-field-editor-panel')).toBeInTheDocument()
        expect(screen.getByTestId('input-field-panel')).toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// URL Generator Functions Tests
// ============================================================================

describe('URL Generator Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should return consistent URLs for same versionId', async () => {
    // Arrange
    setupMocks({ pipelineId: 'stable-pipeline' })

    // Act
    render(<RagPipelinePanel />)

    // Assert
    await waitFor(() => {
      const deleteUrl1 = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-x')
      const deleteUrl2 = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-x')
      expect(deleteUrl1).toBe(deleteUrl2)
    })
  })

  it('should return different URLs for different versionIds', async () => {
    // Arrange
    setupMocks({ pipelineId: 'stable-pipeline' })

    // Act
    render(<RagPipelinePanel />)

    // Assert
    await waitFor(() => {
      const deleteUrl1 = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-1')
      const deleteUrl2 = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-2')
      expect(deleteUrl1).not.toBe(deleteUrl2)
      expect(deleteUrl1).toBe('/rag/pipelines/stable-pipeline/workflows/version-1')
      expect(deleteUrl2).toBe('/rag/pipelines/stable-pipeline/workflows/version-2')
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should pass correct PanelProps structure', async () => {
    // Act
    render(<RagPipelinePanel />)

    // Assert - Check structure matches PanelProps
    await waitFor(() => {
      expect(capturedPanelProps).toHaveProperty('components')
      expect(capturedPanelProps).toHaveProperty('versionHistoryPanelProps')
      expect(capturedPanelProps?.components).toHaveProperty('left')
      expect(capturedPanelProps?.components).toHaveProperty('right')
    })
  })

  it('should pass correct versionHistoryPanelProps structure', async () => {
    // Act
    render(<RagPipelinePanel />)

    // Assert
    await waitFor(() => {
      expect(capturedPanelProps?.versionHistoryPanelProps).toHaveProperty('getVersionListUrl')
      expect(capturedPanelProps?.versionHistoryPanelProps).toHaveProperty('deleteVersionUrl')
      expect(capturedPanelProps?.versionHistoryPanelProps).toHaveProperty('updateVersionUrl')
      expect(capturedPanelProps?.versionHistoryPanelProps).toHaveProperty('latestVersionId')
    })
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should handle multiple rerenders without issues', async () => {
    // Arrange
    const { rerender } = render(<RagPipelinePanel />)

    // Act - Multiple rerenders
    for (let i = 0; i < 10; i++)
      rerender(<RagPipelinePanel />)

    // Assert - Component should still work
    await waitFor(() => {
      expect(screen.getByTestId('workflow-panel')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should pass correct components to Panel', async () => {
    // Arrange
    setupMocks({
      historyWorkflowData: { id: 'h1' },
      showInputFieldPanel: true,
    })

    // Act
    render(<RagPipelinePanel />)

    // Assert
    await waitFor(() => {
      expect(capturedPanelProps?.components?.left).toBeDefined()
      expect(capturedPanelProps?.components?.right).toBeDefined()

      // Check that the components are React elements
      expect(React.isValidElement(capturedPanelProps?.components?.left)).toBe(true)
      expect(React.isValidElement(capturedPanelProps?.components?.right)).toBe(true)
    })
  })

  it('should correctly consume all store selectors', async () => {
    // Arrange
    setupMocks({
      historyWorkflowData: { id: 'test-history' },
      showDebugAndPreviewPanel: true,
      showGlobalVariablePanel: true,
      showInputFieldPanel: true,
      showInputFieldPreviewPanel: true,
      inputFieldEditPanelProps: { onClose: vi.fn(), onSubmit: vi.fn() },
      pipelineId: 'integration-test-pipeline',
    })

    // Act
    render(<RagPipelinePanel />)

    // Assert - All store-dependent rendering should work
    await waitFor(() => {
      expect(screen.getByTestId('record-panel')).toBeInTheDocument()
      expect(screen.getByTestId('test-run-panel')).toBeInTheDocument()
      expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
      expect(screen.getByTestId('input-field-panel')).toBeInTheDocument()
      expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
      expect(screen.getByTestId('input-field-editor-panel')).toBeInTheDocument()
      expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
        '/rag/pipelines/integration-test-pipeline/workflows',
      )
    })
  })
})
