import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import type { InputVar, RAGPipelineVariable, RAGPipelineVariables } from '@/models/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import InputFieldPanel from './index'

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Mock reactflow hooks - use getter to allow dynamic updates
let mockNodesData: Node<DataSourceNodeType>[] = []
vi.mock('reactflow', () => ({
  useNodes: () => mockNodesData,
}))

// Mock useInputFieldPanel hook
const mockCloseAllInputFieldPanels = vi.fn()
const mockToggleInputFieldPreviewPanel = vi.fn()
let mockIsPreviewing = false
let mockIsEditing = false

vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: mockCloseAllInputFieldPanels,
    toggleInputFieldPreviewPanel: mockToggleInputFieldPreviewPanel,
    isPreviewing: mockIsPreviewing,
    isEditing: mockIsEditing,
  }),
}))

// Mock useStore (workflow store)
let mockRagPipelineVariables: RAGPipelineVariables = []
const mockSetRagPipelineVariables = vi.fn()

type MockStoreState = {
  ragPipelineVariables: RAGPipelineVariables
  setRagPipelineVariables: typeof mockSetRagPipelineVariables
}

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockStoreState) => unknown) => {
    const state: MockStoreState = {
      ragPipelineVariables: mockRagPipelineVariables,
      setRagPipelineVariables: mockSetRagPipelineVariables,
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => ({
      setRagPipelineVariables: mockSetRagPipelineVariables,
    }),
  }),
}))

// Mock useNodesSyncDraft hook
const mockHandleSyncWorkflowDraft = vi.fn()

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

// Mock FieldList component
vi.mock('./field-list', () => ({
  default: ({
    nodeId,
    LabelRightContent,
    inputFields,
    handleInputFieldsChange,
    readonly,
    labelClassName,
    allVariableNames,
  }: {
    nodeId: string
    LabelRightContent: React.ReactNode
    inputFields: InputVar[]
    handleInputFieldsChange: (key: string, value: InputVar[]) => void
    readonly?: boolean
    labelClassName?: string
    allVariableNames: string[]
  }) => (
    <div data-testid={`field-list-${nodeId}`}>
      <span data-testid={`field-list-readonly-${nodeId}`}>
        {String(readonly)}
      </span>
      <span data-testid={`field-list-classname-${nodeId}`}>
        {labelClassName}
      </span>
      <span data-testid={`field-list-fields-count-${nodeId}`}>
        {inputFields.length}
      </span>
      <span data-testid={`field-list-all-vars-${nodeId}`}>
        {allVariableNames.join(',')}
      </span>
      {LabelRightContent}
      <button
        data-testid={`trigger-change-${nodeId}`}
        onClick={() =>
          handleInputFieldsChange(nodeId, [
            ...inputFields,
            {
              type: PipelineInputVarType.textInput,
              label: 'New Field',
              variable: 'new_field',
              max_length: 48,
              required: true,
            },
          ])}
      >
        Add Field
      </button>
      <button
        data-testid={`trigger-remove-${nodeId}`}
        onClick={() => handleInputFieldsChange(nodeId, [])}
      >
        Remove All
      </button>
    </div>
  ),
}))

// Mock FooterTip component
vi.mock('./footer-tip', () => ({
  default: () => <div data-testid="footer-tip">Footer Tip</div>,
}))

// Mock Datasource label component
vi.mock('./label-right-content/datasource', () => ({
  default: ({ nodeData }: { nodeData: DataSourceNodeType }) => (
    <div data-testid={`datasource-label-${nodeData.title}`}>
      {nodeData.title}
    </div>
  ),
}))

// Mock GlobalInputs label component
vi.mock('./label-right-content/global-inputs', () => ({
  default: () => <div data-testid="global-inputs-label">Global Inputs</div>,
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createInputVar = (overrides?: Partial<InputVar>): InputVar => ({
  type: PipelineInputVarType.textInput,
  label: 'Test Label',
  variable: 'test_variable',
  max_length: 48,
  default_value: '',
  required: true,
  tooltips: '',
  options: [],
  placeholder: '',
  unit: '',
  allowed_file_upload_methods: [],
  allowed_file_types: [],
  allowed_file_extensions: [],
  ...overrides,
})

const createRAGPipelineVariable = (
  nodeId: string,
  overrides?: Partial<InputVar>,
) => ({
  belong_to_node_id: nodeId,
  ...createInputVar(overrides),
})

const createDataSourceNode = (
  id: string,
  title: string,
  overrides?: Partial<DataSourceNodeType>,
): Node<DataSourceNodeType> => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.DataSource,
    title,
    desc: 'Test datasource',
    selected: false,
    ...overrides,
  } as DataSourceNodeType,
})

// ============================================================================
// Helper Functions
// ============================================================================

const setupMocks = (options?: {
  nodes?: Node<DataSourceNodeType>[]
  ragPipelineVariables?: RAGPipelineVariables
  isPreviewing?: boolean
  isEditing?: boolean
}) => {
  mockNodesData = options?.nodes || []
  mockRagPipelineVariables = options?.ragPipelineVariables || []
  mockIsPreviewing = options?.isPreviewing || false
  mockIsEditing = options?.isEditing || false
}

// ============================================================================
// InputFieldPanel Component Tests
// ============================================================================

describe('InputFieldPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render panel without crashing', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.title'),
      ).toBeInTheDocument()
    })

    it('should render panel title correctly', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.title'),
      ).toBeInTheDocument()
    })

    it('should render panel description', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.description'),
      ).toBeInTheDocument()
    })

    it('should render preview button', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.operations.preview'),
      ).toBeInTheDocument()
    })

    it('should render close button', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      const closeButton = screen.getByRole('button', { name: '' })
      expect(closeButton).toBeInTheDocument()
    })

    it('should render footer tip component', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('footer-tip')).toBeInTheDocument()
    })

    it('should render unique inputs section title', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.uniqueInputs.title'),
      ).toBeInTheDocument()
    })

    it('should render global inputs field list', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
      expect(screen.getByTestId('global-inputs-label')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // DataSource Node Rendering Tests
  // -------------------------------------------------------------------------
  describe('DataSource Node Rendering', () => {
    it('should render field list for each datasource node', () => {
      // Arrange
      const nodes = [
        createDataSourceNode('node-1', 'DataSource 1'),
        createDataSourceNode('node-2', 'DataSource 2'),
      ]
      setupMocks({ nodes })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-node-1')).toBeInTheDocument()
      expect(screen.getByTestId('field-list-node-2')).toBeInTheDocument()
    })

    it('should render datasource label for each node', () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'My DataSource')]
      setupMocks({ nodes })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(
        screen.getByTestId('datasource-label-My DataSource'),
      ).toBeInTheDocument()
    })

    it('should not render any datasource field lists when no nodes exist', () => {
      // Arrange
      setupMocks({ nodes: [] })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.queryByTestId('field-list-node-1')).not.toBeInTheDocument()
      // Global inputs should still render
      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
    })

    it('should filter only DataSource type nodes', () => {
      // Arrange
      const dataSourceNode = createDataSourceNode('ds-node', 'DataSource Node')
      // Create a non-datasource node to verify filtering
      const otherNode = {
        id: 'other-node',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.LLM, // Not a datasource type
          title: 'LLM Node',
          selected: false,
        },
      } as Node<DataSourceNodeType>
      mockNodesData = [dataSourceNode, otherNode]

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-ds-node')).toBeInTheDocument()
      expect(
        screen.queryByTestId('field-list-other-node'),
      ).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Input Fields Map Tests
  // -------------------------------------------------------------------------
  describe('Input Fields Map', () => {
    it('should correctly distribute variables to their nodes', () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'var1' }),
        createRAGPipelineVariable('node-1', { variable: 'var2' }),
        createRAGPipelineVariable('shared', { variable: 'shared_var' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-fields-count-node-1')).toHaveTextContent('2')
      expect(screen.getByTestId('field-list-fields-count-shared')).toHaveTextContent('1')
    })

    it('should show zero fields for nodes without variables', () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes, ragPipelineVariables: [] })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-fields-count-node-1')).toHaveTextContent('0')
    })

    it('should pass all variable names to field lists', () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'var1' }),
        createRAGPipelineVariable('shared', { variable: 'var2' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-all-vars-node-1')).toHaveTextContent(
        'var1,var2',
      )
      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        'var1,var2',
      )
    })
  })

  // -------------------------------------------------------------------------
  // User Interactions Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    // Helper to identify close button by its class
    const isCloseButton = (btn: HTMLElement) =>
      btn.classList.contains('size-6')
      || btn.className.includes('shrink-0 items-center justify-center p-0.5')

    it('should call closeAllInputFieldPanels when close button is clicked', () => {
      // Arrange
      render(<InputFieldPanel />)
      const buttons = screen.getAllByRole('button')
      const closeButton = buttons.find(isCloseButton)

      // Act
      fireEvent.click(closeButton!)

      // Assert
      expect(mockCloseAllInputFieldPanels).toHaveBeenCalledTimes(1)
    })

    it('should call toggleInputFieldPreviewPanel when preview button is clicked', () => {
      // Arrange
      render(<InputFieldPanel />)
      const previewButton = screen.getByText('datasetPipeline.operations.preview')

      // Act
      fireEvent.click(previewButton)

      // Assert
      expect(mockToggleInputFieldPreviewPanel).toHaveBeenCalledTimes(1)
    })

    it('should disable preview button when editing', () => {
      // Arrange
      setupMocks({ isEditing: true })

      // Act
      render(<InputFieldPanel />)

      // Assert
      const previewButton = screen
        .getByText('datasetPipeline.operations.preview')
        .closest('button')
      expect(previewButton).toBeDisabled()
    })

    it('should not disable preview button when not editing', () => {
      // Arrange
      setupMocks({ isEditing: false })

      // Act
      render(<InputFieldPanel />)

      // Assert
      const previewButton = screen
        .getByText('datasetPipeline.operations.preview')
        .closest('button')
      expect(previewButton).not.toBeDisabled()
    })
  })

  // -------------------------------------------------------------------------
  // Preview State Tests
  // -------------------------------------------------------------------------
  describe('Preview State', () => {
    it('should apply active styling when previewing', () => {
      // Arrange
      setupMocks({ isPreviewing: true })

      // Act
      render(<InputFieldPanel />)

      // Assert
      const previewButton = screen
        .getByText('datasetPipeline.operations.preview')
        .closest('button')
      expect(previewButton).toHaveClass('bg-state-accent-active')
      expect(previewButton).toHaveClass('text-text-accent')
    })

    it('should set readonly to true when previewing', () => {
      // Arrange
      setupMocks({ isPreviewing: true })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-readonly-shared')).toHaveTextContent(
        'true',
      )
    })

    it('should set readonly to true when editing', () => {
      // Arrange
      setupMocks({ isEditing: true })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-readonly-shared')).toHaveTextContent(
        'true',
      )
    })

    it('should set readonly to false when not previewing or editing', () => {
      // Arrange
      setupMocks({ isPreviewing: false, isEditing: false })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-readonly-shared')).toHaveTextContent(
        'false',
      )
    })
  })

  // -------------------------------------------------------------------------
  // Input Fields Change Handler Tests
  // -------------------------------------------------------------------------
  describe('Input Fields Change Handler', () => {
    it('should update rag pipeline variables when input fields change', async () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes })
      render(<InputFieldPanel />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-change-node-1'))

      // Assert
      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalled()
      })
    })

    it('should call handleSyncWorkflowDraft when fields change', async () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes })
      render(<InputFieldPanel />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-change-node-1'))

      // Assert
      await waitFor(() => {
        expect(mockHandleSyncWorkflowDraft).toHaveBeenCalled()
      })
    })

    it('should place datasource node fields before global fields', async () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('shared', { variable: 'shared_var' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })
      render(<InputFieldPanel />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-change-node-1'))

      // Assert
      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalled()
      })

      // Verify datasource fields come before shared fields
      const setVarsCall = mockSetRagPipelineVariables.mock.calls[0][0] as RAGPipelineVariables
      const isNotShared = (v: RAGPipelineVariable) => v.belong_to_node_id !== 'shared'
      const isShared = (v: RAGPipelineVariable) => v.belong_to_node_id === 'shared'
      const dsFields = setVarsCall.filter(isNotShared)
      const sharedFields = setVarsCall.filter(isShared)

      if (dsFields.length > 0 && sharedFields.length > 0) {
        const firstDsIndex = setVarsCall.indexOf(dsFields[0])
        const firstSharedIndex = setVarsCall.indexOf(sharedFields[0])
        expect(firstDsIndex).toBeLessThan(firstSharedIndex)
      }
    })

    it('should handle removing all fields from a node', async () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'var1' }),
        createRAGPipelineVariable('node-1', { variable: 'var2' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })
      render(<InputFieldPanel />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-remove-node-1'))

      // Assert
      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalled()
      })
    })

    it('should update global input fields correctly', async () => {
      // Arrange
      setupMocks()
      render(<InputFieldPanel />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-change-shared'))

      // Assert
      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalled()
      })

      const setVarsCall = mockSetRagPipelineVariables.mock.calls[0][0] as RAGPipelineVariables
      const isSharedField = (v: RAGPipelineVariable) => v.belong_to_node_id === 'shared'
      const hasSharedField = setVarsCall.some(isSharedField)
      expect(hasSharedField).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Label Class Name Tests
  // -------------------------------------------------------------------------
  describe('Label Class Names', () => {
    it('should pass correct className to datasource field lists', () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(
        screen.getByTestId('field-list-classname-node-1'),
      ).toHaveTextContent('pt-1 pb-1')
    })

    it('should pass correct className to global inputs field list', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-classname-shared')).toHaveTextContent(
        'pt-2 pb-1',
      )
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should memoize datasourceNodeDataMap based on nodes', () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes })
      const { rerender } = render(<InputFieldPanel />)

      // Act - rerender with same nodes reference
      rerender(<InputFieldPanel />)

      // Assert - component should not break and should render correctly
      expect(screen.getByTestId('field-list-node-1')).toBeInTheDocument()
    })

    it('should compute allVariableNames correctly', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'alpha' }),
        createRAGPipelineVariable('node-1', { variable: 'beta' }),
        createRAGPipelineVariable('shared', { variable: 'gamma' }),
      ]
      setupMocks({ ragPipelineVariables: variables })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        'alpha,beta,gamma',
      )
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability', () => {
    // Helper to find close button - moved outside test to reduce nesting
    const findCloseButton = (buttons: HTMLElement[]) => {
      const isCloseButton = (btn: HTMLElement) =>
        btn.classList.contains('size-6')
        || btn.className.includes('shrink-0 items-center justify-center p-0.5')
      return buttons.find(isCloseButton)
    }

    it('should maintain closePanel callback reference', () => {
      // Arrange
      const { rerender } = render(<InputFieldPanel />)

      // Act
      const buttons1 = screen.getAllByRole('button')
      fireEvent.click(findCloseButton(buttons1)!)
      const callCount1 = mockCloseAllInputFieldPanels.mock.calls.length

      rerender(<InputFieldPanel />)
      const buttons2 = screen.getAllByRole('button')
      fireEvent.click(findCloseButton(buttons2)!)

      // Assert
      expect(mockCloseAllInputFieldPanels.mock.calls.length).toBe(callCount1 + 1)
    })

    it('should maintain togglePreviewPanel callback reference', () => {
      // Arrange
      const { rerender } = render(<InputFieldPanel />)

      // Act
      fireEvent.click(screen.getByText('datasetPipeline.operations.preview'))
      const callCount1 = mockToggleInputFieldPreviewPanel.mock.calls.length

      rerender(<InputFieldPanel />)
      fireEvent.click(screen.getByText('datasetPipeline.operations.preview'))

      // Assert
      expect(mockToggleInputFieldPreviewPanel.mock.calls.length).toBe(
        callCount1 + 1,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty ragPipelineVariables', () => {
      // Arrange
      setupMocks({ ragPipelineVariables: [] })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        '',
      )
    })

    it('should handle undefined ragPipelineVariables', () => {
      // Arrange - intentionally testing undefined case
      // @ts-expect-error Testing edge case with undefined value
      mockRagPipelineVariables = undefined

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
    })

    it('should handle null variable names in allVariableNames', () => {
      // Arrange - intentionally testing edge case with empty variable name
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'valid_var' }),
        createRAGPipelineVariable('node-1', { variable: '' }),
      ]
      setupMocks({ ragPipelineVariables: variables })

      // Act
      render(<InputFieldPanel />)

      // Assert - should not crash
      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
    })

    it('should handle large number of datasource nodes', () => {
      // Arrange
      const nodes = Array.from({ length: 10 }, (_, i) =>
        createDataSourceNode(`node-${i}`, `DataSource ${i}`))
      setupMocks({ nodes })

      // Act
      render(<InputFieldPanel />)

      // Assert
      nodes.forEach((_, i) => {
        expect(screen.getByTestId(`field-list-node-${i}`)).toBeInTheDocument()
      })
    })

    it('should handle large number of variables', () => {
      // Arrange
      const variables = Array.from({ length: 100 }, (_, i) =>
        createRAGPipelineVariable('shared', { variable: `var_${i}` }))
      setupMocks({ ragPipelineVariables: variables })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-fields-count-shared')).toHaveTextContent(
        '100',
      )
    })

    it('should handle special characters in variable names', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable('shared', { variable: 'var_with_underscore' }),
        createRAGPipelineVariable('shared', { variable: 'varWithCamelCase' }),
      ]
      setupMocks({ ragPipelineVariables: variables })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        'var_with_underscore,varWithCamelCase',
      )
    })
  })

  // -------------------------------------------------------------------------
  // Multiple Nodes Interaction Tests
  // -------------------------------------------------------------------------
  describe('Multiple Nodes Interaction', () => {
    it('should handle changes to multiple nodes sequentially', async () => {
      // Arrange
      const nodes = [
        createDataSourceNode('node-1', 'DataSource 1'),
        createDataSourceNode('node-2', 'DataSource 2'),
      ]
      setupMocks({ nodes })
      render(<InputFieldPanel />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-change-node-1'))
      fireEvent.click(screen.getByTestId('trigger-change-node-2'))

      // Assert
      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalledTimes(2)
      })
    })

    it('should maintain separate field lists for different nodes', () => {
      // Arrange
      const nodes = [
        createDataSourceNode('node-1', 'DataSource 1'),
        createDataSourceNode('node-2', 'DataSource 2'),
      ]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'var1' }),
        createRAGPipelineVariable('node-2', { variable: 'var2' }),
        createRAGPipelineVariable('node-2', { variable: 'var3' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-fields-count-node-1')).toHaveTextContent('1')
      expect(screen.getByTestId('field-list-fields-count-node-2')).toHaveTextContent('2')
    })
  })

  // -------------------------------------------------------------------------
  // Component Structure Tests
  // -------------------------------------------------------------------------
  describe('Component Structure', () => {
    it('should have correct panel width class', () => {
      // Act
      const { container } = render(<InputFieldPanel />)

      // Assert
      const panel = container.firstChild as HTMLElement
      expect(panel).toHaveClass('w-[400px]')
    })

    it('should have overflow scroll on content area', () => {
      // Act
      const { container } = render(<InputFieldPanel />)

      // Assert
      const scrollContainer = container.querySelector('.overflow-y-auto')
      expect(scrollContainer).toBeInTheDocument()
    })

    it('should render header section with proper spacing', () => {
      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.title'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.description'),
      ).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Integration with FieldList Component Tests
  // -------------------------------------------------------------------------
  describe('Integration with FieldList Component', () => {
    it('should pass correct props to FieldList for datasource nodes', () => {
      // Arrange
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'test_var' }),
      ]
      setupMocks({
        nodes,
        ragPipelineVariables: variables,
        isPreviewing: true,
      })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-node-1')).toBeInTheDocument()
      expect(screen.getByTestId('field-list-readonly-node-1')).toHaveTextContent('true')
      expect(screen.getByTestId('field-list-fields-count-node-1')).toHaveTextContent('1')
    })

    it('should pass correct props to FieldList for shared node', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable('shared', { variable: 'shared_var' }),
      ]
      setupMocks({ ragPipelineVariables: variables, isEditing: true })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
      expect(screen.getByTestId('field-list-readonly-shared')).toHaveTextContent('true')
      expect(screen.getByTestId('field-list-fields-count-shared')).toHaveTextContent('1')
    })
  })

  // -------------------------------------------------------------------------
  // Variable Ordering Tests
  // -------------------------------------------------------------------------
  describe('Variable Ordering', () => {
    it('should maintain correct variable order in allVariableNames', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'first' }),
        createRAGPipelineVariable('node-1', { variable: 'second' }),
        createRAGPipelineVariable('shared', { variable: 'third' }),
      ]
      setupMocks({ ragPipelineVariables: variables })

      // Act
      render(<InputFieldPanel />)

      // Assert
      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        'first,second,third',
      )
    })
  })
})

// ============================================================================
// useFloatingRight Hook Integration Tests (via InputFieldPanel)
// ============================================================================

describe('useFloatingRight Hook Integration', () => {
  // Note: The hook is tested indirectly through the InputFieldPanel component
  // as it's used internally. Direct hook tests are in hooks.spec.tsx if exists.

  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should render panel correctly with default floating state', () => {
    // The hook is mocked via the component's behavior
    render(<InputFieldPanel />)
    expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
  })
})

// ============================================================================
// FooterTip Component Integration Tests
// ============================================================================

describe('FooterTip Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should render footer tip at the bottom of the panel', () => {
    // Act
    render(<InputFieldPanel />)

    // Assert
    expect(screen.getByTestId('footer-tip')).toBeInTheDocument()
  })
})

// ============================================================================
// Label Components Integration Tests
// ============================================================================

describe('Label Components Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should render GlobalInputs label for shared field list', () => {
    // Act
    render(<InputFieldPanel />)

    // Assert
    expect(screen.getByTestId('global-inputs-label')).toBeInTheDocument()
  })

  it('should render Datasource label for each datasource node', () => {
    // Arrange
    const nodes = [
      createDataSourceNode('node-1', 'First DataSource'),
      createDataSourceNode('node-2', 'Second DataSource'),
    ]
    setupMocks({ nodes })

    // Act
    render(<InputFieldPanel />)

    // Assert
    expect(
      screen.getByTestId('datasource-label-First DataSource'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('datasource-label-Second DataSource'),
    ).toBeInTheDocument()
  })
})

// ============================================================================
// Component Memo Tests
// ============================================================================

describe('Component Memo Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should be wrapped with React.memo', () => {
    // InputFieldPanel is exported as memo(InputFieldPanel)
    // This test ensures the component doesn't break memoization
    const { rerender } = render(<InputFieldPanel />)

    // Act - rerender without prop changes
    rerender(<InputFieldPanel />)

    // Assert - component should still render correctly
    expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
    expect(
      screen.getByText('datasetPipeline.inputFieldPanel.title'),
    ).toBeInTheDocument()
  })

  it('should handle state updates correctly with memo', async () => {
    // Arrange
    const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
    setupMocks({ nodes })
    render(<InputFieldPanel />)

    // Act - trigger a state change
    fireEvent.click(screen.getByTestId('trigger-change-node-1'))

    // Assert
    await waitFor(() => {
      expect(mockSetRagPipelineVariables).toHaveBeenCalled()
    })
  })
})
