import type { PanelProps } from '@/app/components/workflow/panel'
import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import RagPipelinePanel from '../index'

vi.mock('reactflow', () => ({
  useNodes: () => [],
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => [],
    }),
  }),
  useReactFlow: () => ({
    getNodes: () => [],
  }),
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      getNodes: () => [],
    }
    return selector(state)
  },
}))

const { dynamicMocks, mockInputFieldEditorProps } = vi.hoisted(() => {
  let counter = 0
  const mockInputFieldEditorProps = vi.fn()

  const createMockComponent = () => {
    const index = counter++
    switch (index) {
      case 0:
        return () => <div data-testid="record-panel">Record Panel</div>
      case 1:
        return () => <div data-testid="test-run-panel">Test Run Panel</div>
      case 2:
        return () => <div data-testid="input-field-panel">Input Field Panel</div>
      case 3:
        return (props: Record<string, unknown>) => {
          mockInputFieldEditorProps(props)
          return <div data-testid="input-field-editor-panel">Input Field Editor Panel</div>
        }
      case 4:
        return () => <div data-testid="preview-panel">Preview Panel</div>
      case 5:
        return () => <div data-testid="global-variable-panel">Global Variable Panel</div>
      default:
        return () => (
          <div data-testid="dynamic-fallback">
            Dynamic Component
            {index}
          </div>
        )
    }
  }

  return { dynamicMocks: { createMockComponent }, mockInputFieldEditorProps }
})

vi.mock('next/dynamic', () => ({
  default: (_loader: () => Promise<{ default: React.ComponentType }>, _options?: Record<string, unknown>) => {
    return dynamicMocks.createMockComponent()
  },
}))

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
  nodePanelWidth: number
  workflowCanvasWidth: number
  otherPanelWidth: number
  setShowInputFieldPanel?: (show: boolean) => void
  setShowInputFieldPreviewPanel?: (show: boolean) => void
  setInputFieldEditPanelProps?: (props: Record<string, unknown> | null) => void
}

const mockWorkflowStoreState: MockStoreState = {
  historyWorkflowData: null,
  showDebugAndPreviewPanel: false,
  showGlobalVariablePanel: false,
  showInputFieldPanel: false,
  showInputFieldPreviewPanel: false,
  inputFieldEditPanelProps: null,
  pipelineId: 'test-pipeline-123',
  nodePanelWidth: 400,
  workflowCanvasWidth: 1200,
  otherPanelWidth: 0,
  setShowInputFieldPanel: vi.fn(),
  setShowInputFieldPreviewPanel: vi.fn(),
  setInputFieldEditPanelProps: vi.fn(),
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
      nodePanelWidth: 400,
      workflowCanvasWidth: 1200,
      otherPanelWidth: 0,
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => mockWorkflowStoreState,
  }),
}))

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

describe('RagPipelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', async () => {
      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('workflow-panel')).toBeInTheDocument()
      })
    })

    it('should render Panel component with correct structure', async () => {
      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('panel-left')).toBeInTheDocument()
        expect(screen.getByTestId('panel-right')).toBeInTheDocument()
      })
    })

    it('should pass versionHistoryPanelProps to Panel', async () => {
      setupMocks({ pipelineId: 'my-pipeline-456' })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps).toBeDefined()
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
          '/rag/pipelines/my-pipeline-456/workflows',
        )
      })
    })
  })

  describe('Memoization - versionHistoryPanelProps', () => {
    it('should compute correct getVersionListUrl based on pipelineId', async () => {
      setupMocks({ pipelineId: 'pipeline-abc' })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
          '/rag/pipelines/pipeline-abc/workflows',
        )
      })
    })

    it('should compute correct deleteVersionUrl function', async () => {
      setupMocks({ pipelineId: 'pipeline-xyz' })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        const deleteUrl = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-1')
        expect(deleteUrl).toBe('/rag/pipelines/pipeline-xyz/workflows/version-1')
      })
    })

    it('should compute correct updateVersionUrl function', async () => {
      setupMocks({ pipelineId: 'pipeline-def' })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        const updateUrl = capturedPanelProps?.versionHistoryPanelProps?.updateVersionUrl?.('version-2')
        expect(updateUrl).toBe('/rag/pipelines/pipeline-def/workflows/version-2')
      })
    })

    it('should set latestVersionId to empty string', async () => {
      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.latestVersionId).toBe('')
      })
    })
  })

  describe('Memoization - panelProps', () => {
    it('should pass components.left to Panel', async () => {
      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(capturedPanelProps?.components?.left).toBeDefined()
      })
    })

    it('should pass components.right to Panel', async () => {
      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(capturedPanelProps?.components?.right).toBeDefined()
      })
    })

    it('should pass versionHistoryPanelProps to panelProps', async () => {
      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps).toBeDefined()
      })
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', async () => {
      const { rerender } = render(<RagPipelinePanel />)

      rerender(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('workflow-panel')).toBeInTheDocument()
      })
    })
  })
})

describe('RagPipelinePanelOnRight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  describe('Record Panel Conditional Rendering', () => {
    it('should render Record panel when historyWorkflowData exists', async () => {
      setupMocks({ historyWorkflowData: { id: 'history-1' } })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('record-panel')).toBeInTheDocument()
      })
    })

    it('should not render Record panel when historyWorkflowData is null', async () => {
      setupMocks({ historyWorkflowData: null })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
      })
    })

    it('should not render Record panel when historyWorkflowData is undefined', async () => {
      setupMocks({ historyWorkflowData: undefined })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
      })
    })
  })

  describe('TestRun Panel Conditional Rendering', () => {
    it('should render TestRun panel when showDebugAndPreviewPanel is true', async () => {
      setupMocks({ showDebugAndPreviewPanel: true })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('test-run-panel')).toBeInTheDocument()
      })
    })

    it('should not render TestRun panel when showDebugAndPreviewPanel is false', async () => {
      setupMocks({ showDebugAndPreviewPanel: false })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('test-run-panel')).not.toBeInTheDocument()
      })
    })
  })

  describe('GlobalVariable Panel Conditional Rendering', () => {
    it('should render GlobalVariable panel when showGlobalVariablePanel is true', async () => {
      setupMocks({ showGlobalVariablePanel: true })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
      })
    })

    it('should not render GlobalVariable panel when showGlobalVariablePanel is false', async () => {
      setupMocks({ showGlobalVariablePanel: false })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('global-variable-panel')).not.toBeInTheDocument()
      })
    })
  })

  describe('Multiple Panels Rendering', () => {
    it('should render all right panels when all conditions are true', async () => {
      setupMocks({
        historyWorkflowData: { id: 'history-1' },
        showDebugAndPreviewPanel: true,
        showGlobalVariablePanel: true,
      })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('record-panel')).toBeInTheDocument()
        expect(screen.getByTestId('test-run-panel')).toBeInTheDocument()
        expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
      })
    })

    it('should render no right panels when all conditions are false', async () => {
      setupMocks({
        historyWorkflowData: null,
        showDebugAndPreviewPanel: false,
        showGlobalVariablePanel: false,
      })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('test-run-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('global-variable-panel')).not.toBeInTheDocument()
      })
    })

    it('should render only Record and TestRun panels', async () => {
      setupMocks({
        historyWorkflowData: { id: 'history-1' },
        showDebugAndPreviewPanel: true,
        showGlobalVariablePanel: false,
      })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('record-panel')).toBeInTheDocument()
        expect(screen.getByTestId('test-run-panel')).toBeInTheDocument()
        expect(screen.queryByTestId('global-variable-panel')).not.toBeInTheDocument()
      })
    })
  })
})

describe('RagPipelinePanelOnLeft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  describe('Preview Panel Conditional Rendering', () => {
    it('should render Preview panel when showInputFieldPreviewPanel is true', async () => {
      setupMocks({ showInputFieldPreviewPanel: true })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
      })
    })

    it('should not render Preview panel when showInputFieldPreviewPanel is false', async () => {
      setupMocks({ showInputFieldPreviewPanel: false })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument()
      })
    })
  })

  describe('InputFieldEditor Panel Conditional Rendering', () => {
    it('should render InputFieldEditor panel when inputFieldEditPanelProps is provided', async () => {
      const editProps = {
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        initialData: { variable: 'test' },
      }
      setupMocks({ inputFieldEditPanelProps: editProps })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('input-field-editor-panel')).toBeInTheDocument()
      })
    })

    it('should not render InputFieldEditor panel when inputFieldEditPanelProps is null', async () => {
      setupMocks({ inputFieldEditPanelProps: null })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('input-field-editor-panel')).not.toBeInTheDocument()
      })
    })

    it('should pass props to InputFieldEditor panel', async () => {
      const editProps = {
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        initialData: { variable: 'test_var', label: 'Test Label' },
      }
      setupMocks({ inputFieldEditPanelProps: editProps })

      render(<RagPipelinePanel />)

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

  describe('InputField Panel Conditional Rendering', () => {
    it('should render InputField panel when showInputFieldPanel is true', async () => {
      setupMocks({ showInputFieldPanel: true })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('input-field-panel')).toBeInTheDocument()
      })
    })

    it('should not render InputField panel when showInputFieldPanel is false', async () => {
      setupMocks({ showInputFieldPanel: false })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('input-field-panel')).not.toBeInTheDocument()
      })
    })
  })

  describe('Multiple Left Panels Rendering', () => {
    it('should render all left panels when all conditions are true', async () => {
      setupMocks({
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: { onClose: vi.fn(), onSubmit: vi.fn() },
        showInputFieldPanel: true,
      })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
        expect(screen.getByTestId('input-field-editor-panel')).toBeInTheDocument()
        expect(screen.getByTestId('input-field-panel')).toBeInTheDocument()
      })
    })

    it('should render no left panels when all conditions are false', async () => {
      setupMocks({
        showInputFieldPreviewPanel: false,
        inputFieldEditPanelProps: null,
        showInputFieldPanel: false,
      })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('input-field-editor-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('input-field-panel')).not.toBeInTheDocument()
      })
    })

    it('should render only Preview and InputField panels', async () => {
      setupMocks({
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: null,
        showInputFieldPanel: true,
      })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(screen.getByTestId('preview-panel')).toBeInTheDocument()
        expect(screen.queryByTestId('input-field-editor-panel')).not.toBeInTheDocument()
        expect(screen.getByTestId('input-field-panel')).toBeInTheDocument()
      })
    })
  })
})

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  describe('Empty/Undefined Values', () => {
    it('should handle empty pipelineId gracefully', async () => {
      setupMocks({ pipelineId: '' })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
          '/rag/pipelines//workflows',
        )
      })
    })

    it('should handle special characters in pipelineId', async () => {
      setupMocks({ pipelineId: 'pipeline-with-special_chars.123' })

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
          '/rag/pipelines/pipeline-with-special_chars.123/workflows',
        )
      })
    })
  })

  describe('Props Spreading', () => {
    it('should correctly spread inputFieldEditPanelProps to editor component', async () => {
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

      render(<RagPipelinePanel />)

      await waitFor(() => {
        expect(mockInputFieldEditorProps).toHaveBeenCalledWith(
          expect.objectContaining({
            extraProp: 'extra-value',
          }),
        )
      })
    })
  })

  describe('State Combinations', () => {
    it('should handle all panels visible simultaneously', async () => {
      setupMocks({
        historyWorkflowData: { id: 'h1' },
        showDebugAndPreviewPanel: true,
        showGlobalVariablePanel: true,
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: { onClose: vi.fn(), onSubmit: vi.fn() },
        showInputFieldPanel: true,
      })

      render(<RagPipelinePanel />)

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

describe('URL Generator Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should return consistent URLs for same versionId', async () => {
    setupMocks({ pipelineId: 'stable-pipeline' })

    render(<RagPipelinePanel />)

    await waitFor(() => {
      const deleteUrl1 = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-x')
      const deleteUrl2 = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-x')
      expect(deleteUrl1).toBe(deleteUrl2)
    })
  })

  it('should return different URLs for different versionIds', async () => {
    setupMocks({ pipelineId: 'stable-pipeline' })

    render(<RagPipelinePanel />)

    await waitFor(() => {
      const deleteUrl1 = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-1')
      const deleteUrl2 = capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-2')
      expect(deleteUrl1).not.toBe(deleteUrl2)
      expect(deleteUrl1).toBe('/rag/pipelines/stable-pipeline/workflows/version-1')
      expect(deleteUrl2).toBe('/rag/pipelines/stable-pipeline/workflows/version-2')
    })
  })
})

describe('Type Safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should pass correct PanelProps structure', async () => {
    render(<RagPipelinePanel />)

    await waitFor(() => {
      expect(capturedPanelProps).toHaveProperty('components')
      expect(capturedPanelProps).toHaveProperty('versionHistoryPanelProps')
      expect(capturedPanelProps?.components).toHaveProperty('left')
      expect(capturedPanelProps?.components).toHaveProperty('right')
    })
  })

  it('should pass correct versionHistoryPanelProps structure', async () => {
    render(<RagPipelinePanel />)

    await waitFor(() => {
      expect(capturedPanelProps?.versionHistoryPanelProps).toHaveProperty('getVersionListUrl')
      expect(capturedPanelProps?.versionHistoryPanelProps).toHaveProperty('deleteVersionUrl')
      expect(capturedPanelProps?.versionHistoryPanelProps).toHaveProperty('updateVersionUrl')
      expect(capturedPanelProps?.versionHistoryPanelProps).toHaveProperty('latestVersionId')
    })
  })
})

describe('Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should handle multiple rerenders without issues', async () => {
    const { rerender } = render(<RagPipelinePanel />)

    for (let i = 0; i < 10; i++)
      rerender(<RagPipelinePanel />)

    await waitFor(() => {
      expect(screen.getByTestId('workflow-panel')).toBeInTheDocument()
    })
  })
})

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should pass correct components to Panel', async () => {
    setupMocks({
      historyWorkflowData: { id: 'h1' },
      showInputFieldPanel: true,
    })

    render(<RagPipelinePanel />)

    await waitFor(() => {
      expect(capturedPanelProps?.components?.left).toBeDefined()
      expect(capturedPanelProps?.components?.right).toBeDefined()

      expect(React.isValidElement(capturedPanelProps?.components?.left)).toBe(true)
      expect(React.isValidElement(capturedPanelProps?.components?.right)).toBe(true)
    })
  })

  it('should correctly consume all store selectors', async () => {
    setupMocks({
      historyWorkflowData: { id: 'test-history' },
      showDebugAndPreviewPanel: true,
      showGlobalVariablePanel: true,
      showInputFieldPanel: true,
      showInputFieldPreviewPanel: true,
      inputFieldEditPanelProps: { onClose: vi.fn(), onSubmit: vi.fn() },
      pipelineId: 'integration-test-pipeline',
    })

    render(<RagPipelinePanel />)

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
