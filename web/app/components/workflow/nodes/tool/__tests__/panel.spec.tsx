import type { ReactNode } from 'react'
import type { ToolNodeType } from '../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseMatchSchemaType = vi.hoisted(() => vi.fn())
const mockGetMatchedSchemaType = vi.hoisted(() => vi.fn())
const mockWrapStructuredVarItem = vi.hoisted(() => vi.fn())
const mockToolForm = vi.hoisted(() => vi.fn())
const mockStructureOutputItem = vi.hoisted(() => vi.fn())
const mockSplit = vi.hoisted(() => vi.fn())

vi.mock('../hooks/use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof mockWorkflowStoreState) => unknown) => mockUseStore(selector),
}))

vi.mock('../../_base/components/variable/use-match-schema-type', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseMatchSchemaType(...args),
  getMatchedSchemaType: (...args: unknown[]) => mockGetMatchedSchemaType(...args),
}))

vi.mock('@/app/components/workflow/utils/tool', () => ({
  wrapStructuredVarItem: (...args: unknown[]) => mockWrapStructuredVarItem(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: (props: {
    title?: string
    children: ReactNode
    collapsed?: boolean
    onCollapse?: (collapsed: boolean) => void
  }) => (
    <div data-testid="output-vars">
      <div>{props.title ?? 'workflow.nodes.common.outputVars'}</div>
      {props.onCollapse && (
        <button type="button" onClick={() => props.onCollapse?.(!props.collapsed)}>
          toggle-output-vars
        </button>
      )}
      <div>{props.children}</div>
    </div>
  ),
  VarItem: (props: {
    name: string
    type: string
    description: string
  }) => (
    <div data-testid={`var-item-${props.name}`}>
      <span>{props.name}</span>
      <span>{props.type}</span>
      <span>{props.description}</span>
    </div>
  ),
}))

vi.mock('../components/tool-form', () => ({
  __esModule: true,
  default: (props: {
    schema: CredentialFormSchema[]
    showManageInputField?: boolean
    onManageInputField?: () => void
  }) => {
    mockToolForm(props)
    return (
      <div data-testid={`tool-form-${props.schema.map(item => item.variable).join('-') || 'empty'}`}>
        {props.showManageInputField && props.onManageInputField && (
          <button type="button" onClick={props.onManageInputField}>
            Manage Input Field
          </button>
        )}
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show', () => ({
  __esModule: true,
  default: (props: { payload: { id: string } }) => {
    mockStructureOutputItem(props)
    return <div data-testid="structured-output">{props.payload.id}</div>
  },
}))

vi.mock('../../_base/components/split', () => ({
  __esModule: true,
  default: (props: { className?: string }) => {
    mockSplit(props)
    return <div data-testid="split">{props.className ?? 'default'}</div>
  },
}))

const mockWorkflowStoreState = {
  pipelineId: undefined as string | undefined,
  setShowInputFieldPanel: vi.fn(),
}

const createNodeData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  title: 'Google Search',
  desc: '',
  type: BlockEnum.Tool,
  provider_id: 'google_search',
  provider_type: CollectionType.builtIn,
  provider_name: 'Google Search',
  tool_name: 'google_search',
  tool_label: 'Google Search',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

const createSchemaItem = (variable: string): CredentialFormSchema => ({
  name: variable,
  variable,
  label: { en_US: variable, zh_Hans: variable },
  type: FormTypeEnum.textInput,
  required: false,
  show_on: [],
})

const renderPanel = (data: ToolNodeType = createNodeData()) => {
  const props: NodePanelProps<ToolNodeType> = {
    id: 'tool-node-1',
    data,
    panelProps: {
      getInputVars: vi.fn(() => []),
      toVarInputs: vi.fn(() => []),
      runInputData: {},
      runInputDataRef: { current: {} },
      setRunInputData: vi.fn(),
      runResult: null,
    },
  }

  return render(<Panel {...props} />)
}

const createConfigResult = (overrides: Record<string, unknown> = {}) => ({
  readOnly: false,
  inputs: {
    tool_parameters: {},
    tool_configurations: {},
  },
  toolInputVarSchema: [] as CredentialFormSchema[],
  setInputVar: vi.fn(),
  toolSettingSchema: [] as CredentialFormSchema[],
  toolSettingValue: {},
  setToolSettingValue: vi.fn(),
  currCollection: { name: 'google_search' },
  isShowAuthBtn: false,
  isLoading: false,
  outputSchema: [],
  hasObjectOutput: false,
  currTool: { name: 'google_search' },
  ...overrides,
})

describe('ToolPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStoreState.pipelineId = undefined
    mockWorkflowStoreState.setShowInputFieldPanel = vi.fn()
    mockUseStore.mockImplementation(selector => selector(mockWorkflowStoreState))
    mockUseMatchSchemaType.mockReturnValue({
      schemaTypeDefinitions: [{ name: 'structured' }],
    })
    mockGetMatchedSchemaType.mockReturnValue('')
    mockWrapStructuredVarItem.mockImplementation((outputItem, schemaType) => ({
      id: `${outputItem.name}-${schemaType || 'plain'}`,
    }))
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Loading State', () => {
    it('should render loading when config data is still loading', () => {
      mockUseConfig.mockReturnValue(createConfigResult({
        isLoading: true,
      }))

      renderPanel()

      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.queryByText('workflow.nodes.tool.inputVars')).not.toBeInTheDocument()
      expect(mockToolForm).not.toHaveBeenCalled()
    })
  })

  describe('Form Rendering', () => {
    it('should render input and settings forms and forward the manage input field action', () => {
      mockWorkflowStoreState.pipelineId = 'pipeline-1'
      mockUseConfig.mockReturnValue(createConfigResult({
        inputs: {
          tool_parameters: { query: { value: 'weather' } },
          tool_configurations: {},
        },
        toolInputVarSchema: [createSchemaItem('query')],
        toolSettingSchema: [createSchemaItem('region')],
        toolSettingValue: { region: 'us' },
      }))

      renderPanel()

      expect(screen.getByText('workflow.nodes.tool.inputVars')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.tool.settings')).toBeInTheDocument()
      expect(screen.getAllByTestId('split')).toHaveLength(2)

      fireEvent.click(screen.getByRole('button', { name: 'Manage Input Field' }))

      expect(mockToolForm).toHaveBeenCalledTimes(2)
      expect(mockToolForm.mock.calls[0][0]).toEqual(expect.objectContaining({
        nodeId: 'tool-node-1',
        showManageInputField: true,
      }))
      expect(mockToolForm.mock.calls[1][0]).toEqual(expect.objectContaining({
        nodeId: 'tool-node-1',
      }))
      expect(mockToolForm.mock.calls[1][0]).not.toHaveProperty('showManageInputField')
      expect(mockWorkflowStoreState.setShowInputFieldPanel).toHaveBeenCalledWith(true)
    })

    it('should hide editable forms when the auth button is shown but keep output variables visible', () => {
      mockUseConfig.mockReturnValue(createConfigResult({
        isShowAuthBtn: true,
        toolInputVarSchema: [createSchemaItem('query')],
        toolSettingSchema: [createSchemaItem('region')],
      }))

      renderPanel()

      expect(screen.queryByText('workflow.nodes.tool.inputVars')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.nodes.tool.settings')).not.toBeInTheDocument()
      expect(screen.getByText('text')).toBeInTheDocument()
      expect(screen.getByText('files')).toBeInTheDocument()
      expect(screen.getByText('json')).toBeInTheDocument()
      expect(mockToolForm).not.toHaveBeenCalled()
    })
  })

  describe('Output Schema', () => {
    it('should render scalar and structured outputs with matched schema types', () => {
      mockGetMatchedSchemaType.mockImplementation((value: { type?: string }) => {
        return value?.type === 'string' ? 'qa_structured' : 'object_structured'
      })
      mockUseConfig.mockReturnValue(createConfigResult({
        hasObjectOutput: true,
        outputSchema: [
          {
            name: 'summary',
            type: 'String',
            description: 'Summary field',
            value: { type: 'string' },
          },
          {
            name: 'details',
            type: 'Object',
            description: 'Details field',
            value: { type: 'object', properties: {} },
          },
        ],
      }))

      renderPanel()

      expect(screen.getByText('summary')).toBeInTheDocument()
      expect(screen.getByText('string (qa_structured)')).toBeInTheDocument()
      expect(screen.getByText('Summary field')).toBeInTheDocument()
      expect(screen.getByTestId('structured-output')).toHaveTextContent('details-object_structured')
      expect(mockWrapStructuredVarItem).toHaveBeenCalledWith(expect.objectContaining({
        name: 'details',
      }), 'object_structured')
      expect(mockStructureOutputItem).toHaveBeenCalledWith(expect.objectContaining({
        payload: { id: 'details-object_structured' },
      }))
    })

    it('should render scalar outputs without a schema suffix when no schema type matches', () => {
      mockGetMatchedSchemaType.mockReturnValue('')
      mockUseConfig.mockReturnValue(createConfigResult({
        outputSchema: [
          {
            name: 'summary',
            type: 'String',
            description: 'Summary field',
            value: { type: 'string' },
          },
        ],
      }))

      renderPanel()

      expect(screen.getByTestId('var-item-summary')).toHaveTextContent('summary')
      expect(screen.getByTestId('var-item-summary')).toHaveTextContent('String'.toLowerCase())
      expect(screen.getByTestId('var-item-summary')).not.toHaveTextContent('qa_structured')
    })
  })
})
