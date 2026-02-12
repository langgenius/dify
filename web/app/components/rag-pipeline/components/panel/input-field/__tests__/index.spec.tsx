import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import type { InputVar, RAGPipelineVariable, RAGPipelineVariables } from '@/models/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import InputFieldPanel from '../index'

let mockNodesData: Node<DataSourceNodeType>[] = []
vi.mock('reactflow', () => ({
  useNodes: () => mockNodesData,
}))

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

const mockHandleSyncWorkflowDraft = vi.fn()

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('../field-list', () => ({
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

vi.mock('../footer-tip', () => ({
  default: () => <div data-testid="footer-tip">Footer Tip</div>,
}))

vi.mock('../label-right-content/datasource', () => ({
  default: ({ nodeData }: { nodeData: DataSourceNodeType }) => (
    <div data-testid={`datasource-label-${nodeData.title}`}>
      {nodeData.title}
    </div>
  ),
}))

vi.mock('../label-right-content/global-inputs', () => ({
  default: () => <div data-testid="global-inputs-label">Global Inputs</div>,
}))

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

describe('InputFieldPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  describe('Rendering', () => {
    it('should render panel without crashing', () => {
      render(<InputFieldPanel />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.title'),
      ).toBeInTheDocument()
    })

    it('should render panel title correctly', () => {
      render(<InputFieldPanel />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.title'),
      ).toBeInTheDocument()
    })

    it('should render panel description', () => {
      render(<InputFieldPanel />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.description'),
      ).toBeInTheDocument()
    })

    it('should render preview button', () => {
      render(<InputFieldPanel />)

      expect(
        screen.getByText('datasetPipeline.operations.preview'),
      ).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<InputFieldPanel />)

      const closeButton = screen.getByRole('button', { name: '' })
      expect(closeButton).toBeInTheDocument()
    })

    it('should render footer tip component', () => {
      render(<InputFieldPanel />)

      expect(screen.getByTestId('footer-tip')).toBeInTheDocument()
    })

    it('should render unique inputs section title', () => {
      render(<InputFieldPanel />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.uniqueInputs.title'),
      ).toBeInTheDocument()
    })

    it('should render global inputs field list', () => {
      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
      expect(screen.getByTestId('global-inputs-label')).toBeInTheDocument()
    })
  })

  describe('DataSource Node Rendering', () => {
    it('should render field list for each datasource node', () => {
      const nodes = [
        createDataSourceNode('node-1', 'DataSource 1'),
        createDataSourceNode('node-2', 'DataSource 2'),
      ]
      setupMocks({ nodes })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-node-1')).toBeInTheDocument()
      expect(screen.getByTestId('field-list-node-2')).toBeInTheDocument()
    })

    it('should render datasource label for each node', () => {
      const nodes = [createDataSourceNode('node-1', 'My DataSource')]
      setupMocks({ nodes })

      render(<InputFieldPanel />)

      expect(
        screen.getByTestId('datasource-label-My DataSource'),
      ).toBeInTheDocument()
    })

    it('should not render any datasource field lists when no nodes exist', () => {
      setupMocks({ nodes: [] })

      render(<InputFieldPanel />)

      expect(screen.queryByTestId('field-list-node-1')).not.toBeInTheDocument()
      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
    })

    it('should filter only DataSource type nodes', () => {
      const dataSourceNode = createDataSourceNode('ds-node', 'DataSource Node')
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

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-ds-node')).toBeInTheDocument()
      expect(
        screen.queryByTestId('field-list-other-node'),
      ).not.toBeInTheDocument()
    })
  })

  describe('Input Fields Map', () => {
    it('should correctly distribute variables to their nodes', () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'var1' }),
        createRAGPipelineVariable('node-1', { variable: 'var2' }),
        createRAGPipelineVariable('shared', { variable: 'shared_var' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-fields-count-node-1')).toHaveTextContent('2')
      expect(screen.getByTestId('field-list-fields-count-shared')).toHaveTextContent('1')
    })

    it('should show zero fields for nodes without variables', () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes, ragPipelineVariables: [] })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-fields-count-node-1')).toHaveTextContent('0')
    })

    it('should pass all variable names to field lists', () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'var1' }),
        createRAGPipelineVariable('shared', { variable: 'var2' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-all-vars-node-1')).toHaveTextContent(
        'var1,var2',
      )
      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        'var1,var2',
      )
    })
  })

  describe('User Interactions', () => {
    const isCloseButton = (btn: HTMLElement) =>
      btn.classList.contains('size-6')
      || btn.className.includes('shrink-0 items-center justify-center p-0.5')

    it('should call closeAllInputFieldPanels when close button is clicked', () => {
      render(<InputFieldPanel />)
      const buttons = screen.getAllByRole('button')
      const closeButton = buttons.find(isCloseButton)

      fireEvent.click(closeButton!)

      expect(mockCloseAllInputFieldPanels).toHaveBeenCalledTimes(1)
    })

    it('should call toggleInputFieldPreviewPanel when preview button is clicked', () => {
      render(<InputFieldPanel />)
      const previewButton = screen.getByText('datasetPipeline.operations.preview')

      fireEvent.click(previewButton)

      expect(mockToggleInputFieldPreviewPanel).toHaveBeenCalledTimes(1)
    })

    it('should disable preview button when editing', () => {
      setupMocks({ isEditing: true })

      render(<InputFieldPanel />)

      const previewButton = screen
        .getByText('datasetPipeline.operations.preview')
        .closest('button')
      expect(previewButton).toBeDisabled()
    })

    it('should not disable preview button when not editing', () => {
      setupMocks({ isEditing: false })

      render(<InputFieldPanel />)

      const previewButton = screen
        .getByText('datasetPipeline.operations.preview')
        .closest('button')
      expect(previewButton).not.toBeDisabled()
    })
  })

  describe('Preview State', () => {
    it('should apply active styling when previewing', () => {
      setupMocks({ isPreviewing: true })

      render(<InputFieldPanel />)

      const previewButton = screen
        .getByText('datasetPipeline.operations.preview')
        .closest('button')
      expect(previewButton).toHaveClass('bg-state-accent-active')
      expect(previewButton).toHaveClass('text-text-accent')
    })

    it('should set readonly to true when previewing', () => {
      setupMocks({ isPreviewing: true })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-readonly-shared')).toHaveTextContent(
        'true',
      )
    })

    it('should set readonly to true when editing', () => {
      setupMocks({ isEditing: true })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-readonly-shared')).toHaveTextContent(
        'true',
      )
    })

    it('should set readonly to false when not previewing or editing', () => {
      setupMocks({ isPreviewing: false, isEditing: false })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-readonly-shared')).toHaveTextContent(
        'false',
      )
    })
  })

  describe('Input Fields Change Handler', () => {
    it('should update rag pipeline variables when input fields change', async () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes })
      render(<InputFieldPanel />)

      fireEvent.click(screen.getByTestId('trigger-change-node-1'))

      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalled()
      })
    })

    it('should call handleSyncWorkflowDraft when fields change', async () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes })
      render(<InputFieldPanel />)

      fireEvent.click(screen.getByTestId('trigger-change-node-1'))

      await waitFor(() => {
        expect(mockHandleSyncWorkflowDraft).toHaveBeenCalled()
      })
    })

    it('should place datasource node fields before global fields', async () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('shared', { variable: 'shared_var' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })
      render(<InputFieldPanel />)

      fireEvent.click(screen.getByTestId('trigger-change-node-1'))

      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalled()
      })

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
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'var1' }),
        createRAGPipelineVariable('node-1', { variable: 'var2' }),
      ]
      setupMocks({ nodes, ragPipelineVariables: variables })
      render(<InputFieldPanel />)

      fireEvent.click(screen.getByTestId('trigger-remove-node-1'))

      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalled()
      })
    })

    it('should update global input fields correctly', async () => {
      setupMocks()
      render(<InputFieldPanel />)

      fireEvent.click(screen.getByTestId('trigger-change-shared'))

      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalled()
      })

      const setVarsCall = mockSetRagPipelineVariables.mock.calls[0][0] as RAGPipelineVariables
      const isSharedField = (v: RAGPipelineVariable) => v.belong_to_node_id === 'shared'
      const hasSharedField = setVarsCall.some(isSharedField)
      expect(hasSharedField).toBe(true)
    })
  })

  describe('Label Class Names', () => {
    it('should pass correct className to datasource field lists', () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes })

      render(<InputFieldPanel />)

      expect(
        screen.getByTestId('field-list-classname-node-1'),
      ).toHaveTextContent('pt-1 pb-1')
    })

    it('should pass correct className to global inputs field list', () => {
      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-classname-shared')).toHaveTextContent(
        'pt-2 pb-1',
      )
    })
  })

  describe('Memoization', () => {
    it('should memoize datasourceNodeDataMap based on nodes', () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      setupMocks({ nodes })
      const { rerender } = render(<InputFieldPanel />)

      rerender(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-node-1')).toBeInTheDocument()
    })

    it('should compute allVariableNames correctly', () => {
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'alpha' }),
        createRAGPipelineVariable('node-1', { variable: 'beta' }),
        createRAGPipelineVariable('shared', { variable: 'gamma' }),
      ]
      setupMocks({ ragPipelineVariables: variables })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        'alpha,beta,gamma',
      )
    })
  })

  describe('Callback Stability', () => {
    const findCloseButton = (buttons: HTMLElement[]) => {
      const isCloseButton = (btn: HTMLElement) =>
        btn.classList.contains('size-6')
        || btn.className.includes('shrink-0 items-center justify-center p-0.5')
      return buttons.find(isCloseButton)
    }

    it('should maintain closePanel callback reference', () => {
      const { rerender } = render(<InputFieldPanel />)

      const buttons1 = screen.getAllByRole('button')
      fireEvent.click(findCloseButton(buttons1)!)
      const callCount1 = mockCloseAllInputFieldPanels.mock.calls.length

      rerender(<InputFieldPanel />)
      const buttons2 = screen.getAllByRole('button')
      fireEvent.click(findCloseButton(buttons2)!)

      expect(mockCloseAllInputFieldPanels.mock.calls.length).toBe(callCount1 + 1)
    })

    it('should maintain togglePreviewPanel callback reference', () => {
      const { rerender } = render(<InputFieldPanel />)

      fireEvent.click(screen.getByText('datasetPipeline.operations.preview'))
      const callCount1 = mockToggleInputFieldPreviewPanel.mock.calls.length

      rerender(<InputFieldPanel />)
      fireEvent.click(screen.getByText('datasetPipeline.operations.preview'))

      expect(mockToggleInputFieldPreviewPanel.mock.calls.length).toBe(
        callCount1 + 1,
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty ragPipelineVariables', () => {
      setupMocks({ ragPipelineVariables: [] })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        '',
      )
    })

    it('should handle undefined ragPipelineVariables', () => {
      // @ts-expect-error Testing edge case with undefined value
      mockRagPipelineVariables = undefined

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
    })

    it('should handle null variable names in allVariableNames', () => {
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'valid_var' }),
        createRAGPipelineVariable('node-1', { variable: '' }),
      ]
      setupMocks({ ragPipelineVariables: variables })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
    })

    it('should handle large number of datasource nodes', () => {
      const nodes = Array.from({ length: 10 }, (_, i) =>
        createDataSourceNode(`node-${i}`, `DataSource ${i}`))
      setupMocks({ nodes })

      render(<InputFieldPanel />)

      nodes.forEach((_, i) => {
        expect(screen.getByTestId(`field-list-node-${i}`)).toBeInTheDocument()
      })
    })

    it('should handle large number of variables', () => {
      const variables = Array.from({ length: 100 }, (_, i) =>
        createRAGPipelineVariable('shared', { variable: `var_${i}` }))
      setupMocks({ ragPipelineVariables: variables })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-fields-count-shared')).toHaveTextContent(
        '100',
      )
    })

    it('should handle special characters in variable names', () => {
      const variables = [
        createRAGPipelineVariable('shared', { variable: 'var_with_underscore' }),
        createRAGPipelineVariable('shared', { variable: 'varWithCamelCase' }),
      ]
      setupMocks({ ragPipelineVariables: variables })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        'var_with_underscore,varWithCamelCase',
      )
    })
  })

  describe('Multiple Nodes Interaction', () => {
    it('should handle changes to multiple nodes sequentially', async () => {
      const nodes = [
        createDataSourceNode('node-1', 'DataSource 1'),
        createDataSourceNode('node-2', 'DataSource 2'),
      ]
      setupMocks({ nodes })
      render(<InputFieldPanel />)

      fireEvent.click(screen.getByTestId('trigger-change-node-1'))
      fireEvent.click(screen.getByTestId('trigger-change-node-2'))

      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalledTimes(2)
      })
    })

    it('should maintain separate field lists for different nodes', () => {
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

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-fields-count-node-1')).toHaveTextContent('1')
      expect(screen.getByTestId('field-list-fields-count-node-2')).toHaveTextContent('2')
    })
  })

  describe('Component Structure', () => {
    it('should have correct panel width class', () => {
      const { container } = render(<InputFieldPanel />)

      const panel = container.firstChild as HTMLElement
      expect(panel).toHaveClass('w-[400px]')
    })

    it('should have overflow scroll on content area', () => {
      const { container } = render(<InputFieldPanel />)

      const scrollContainer = container.querySelector('.overflow-y-auto')
      expect(scrollContainer).toBeInTheDocument()
    })

    it('should render header section with proper spacing', () => {
      render(<InputFieldPanel />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.title'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.description'),
      ).toBeInTheDocument()
    })
  })

  describe('Integration with FieldList Component', () => {
    it('should pass correct props to FieldList for datasource nodes', () => {
      const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'test_var' }),
      ]
      setupMocks({
        nodes,
        ragPipelineVariables: variables,
        isPreviewing: true,
      })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-node-1')).toBeInTheDocument()
      expect(screen.getByTestId('field-list-readonly-node-1')).toHaveTextContent('true')
      expect(screen.getByTestId('field-list-fields-count-node-1')).toHaveTextContent('1')
    })

    it('should pass correct props to FieldList for shared node', () => {
      const variables = [
        createRAGPipelineVariable('shared', { variable: 'shared_var' }),
      ]
      setupMocks({ ragPipelineVariables: variables, isEditing: true })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
      expect(screen.getByTestId('field-list-readonly-shared')).toHaveTextContent('true')
      expect(screen.getByTestId('field-list-fields-count-shared')).toHaveTextContent('1')
    })
  })

  describe('Variable Ordering', () => {
    it('should maintain correct variable order in allVariableNames', () => {
      const variables = [
        createRAGPipelineVariable('node-1', { variable: 'first' }),
        createRAGPipelineVariable('node-1', { variable: 'second' }),
        createRAGPipelineVariable('shared', { variable: 'third' }),
      ]
      setupMocks({ ragPipelineVariables: variables })

      render(<InputFieldPanel />)

      expect(screen.getByTestId('field-list-all-vars-shared')).toHaveTextContent(
        'first,second,third',
      )
    })
  })
})

describe('useFloatingRight Hook Integration', () => {
  // Note: The hook is tested indirectly through the InputFieldPanel component

  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should render panel correctly with default floating state', () => {
    render(<InputFieldPanel />)
    expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
  })
})

describe('FooterTip Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should render footer tip at the bottom of the panel', () => {
    render(<InputFieldPanel />)

    expect(screen.getByTestId('footer-tip')).toBeInTheDocument()
  })
})

describe('Label Components Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should render GlobalInputs label for shared field list', () => {
    render(<InputFieldPanel />)

    expect(screen.getByTestId('global-inputs-label')).toBeInTheDocument()
  })

  it('should render Datasource label for each datasource node', () => {
    const nodes = [
      createDataSourceNode('node-1', 'First DataSource'),
      createDataSourceNode('node-2', 'Second DataSource'),
    ]
    setupMocks({ nodes })

    render(<InputFieldPanel />)

    expect(
      screen.getByTestId('datasource-label-First DataSource'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('datasource-label-Second DataSource'),
    ).toBeInTheDocument()
  })
})

describe('Component Memo Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('should be wrapped with React.memo', () => {
    const { rerender } = render(<InputFieldPanel />)

    rerender(<InputFieldPanel />)

    expect(screen.getByTestId('field-list-shared')).toBeInTheDocument()
    expect(
      screen.getByText('datasetPipeline.inputFieldPanel.title'),
    ).toBeInTheDocument()
  })

  it('should handle state updates correctly with memo', async () => {
    const nodes = [createDataSourceNode('node-1', 'DataSource 1')]
    setupMocks({ nodes })
    render(<InputFieldPanel />)

    fireEvent.click(screen.getByTestId('trigger-change-node-1'))

    await waitFor(() => {
      expect(mockSetRagPipelineVariables).toHaveBeenCalled()
    })
  })
})
