import type { NodeOutPutVar } from '../../../types'
import type { Condition, LoopNodeType, LoopVariable } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorHandleMode, ValueType } from '@/app/components/workflow/types'
import {
  BlockEnum,
  VarType,
} from '../../../types'
import { VarType as NumberVarType } from '../../tool/types'
import AddBlock from '../add-block'
import ConditionAdd from '../components/condition-add'
import ConditionFilesListValue from '../components/condition-files-list-value'
import ConditionList from '../components/condition-list'
import ConditionItem from '../components/condition-list/condition-item'
import ConditionOperator from '../components/condition-list/condition-operator'
import ConditionNumberInput from '../components/condition-number-input'
import ConditionValue from '../components/condition-value'
import LoopVariables from '../components/loop-variables'
import FormItem from '../components/loop-variables/form-item'
import InputModeSelect from '../components/loop-variables/input-mode-selec'
import VariableTypeSelect from '../components/loop-variables/variable-type-select'
import InsertBlock from '../insert-block'
import Node from '../node'
import Panel from '../panel'
import {
  ComparisonOperator,
  LogicalOperator,
} from '../types'
import useConfig from '../use-config'

const mockHandleNodeAdd = vi.fn()
const mockHandleNodeLoopRerender = vi.fn()
const mockToastNotify = vi.fn()

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    Background: ({ id }: { id: string }) => <div data-testid={id} />,
    useViewport: () => ({ zoom: 1 }),
    useNodesInitialized: () => true,
    useStore: (selector: (state: { d3Selection: null, d3Zoom: null }) => unknown) => selector({
      d3Selection: null,
      d3Zoom: null,
    }),
  }
})

vi.mock('@/app/components/workflow/block-selector', () => ({
  __esModule: true,
  default: ({
    onSelect,
    onOpenChange,
    open,
    availableBlocksTypes = [],
    trigger,
    disabled,
  }: {
    onSelect?: (type: BlockEnum) => void
    onOpenChange?: (open: boolean) => void
    open?: boolean
    availableBlocksTypes?: BlockEnum[]
    trigger?: (open: boolean) => React.ReactNode
    disabled?: boolean
  }) => (
    <div>
      {trigger ? <div>{trigger(Boolean(open))}</div> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onOpenChange?.(!open)
          onSelect?.(availableBlocksTypes[0] ?? BlockEnum.LLM)
        }}
      >
        select-block
      </button>
    </div>
  ),
}))

vi.mock('../../loop-start', () => ({
  LoopStartNodeDumb: () => <div>loop-start-node</div>,
}))

vi.mock('../use-interactions', () => ({
  useNodeLoopInteractions: () => ({
    handleNodeLoopRerender: mockHandleNodeLoopRerender,
  }),
}))

vi.mock('../../../hooks', () => ({
  useAvailableBlocks: () => ({
    availablePrevBlocks: [],
    availableNextBlocks: [BlockEnum.LLM],
  }),
  useNodesInteractions: () => ({
    handleNodeAdd: mockHandleNodeAdd,
  }),
  useNodesReadOnly: () => ({
    nodesReadOnly: false,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-vars', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (valueSelector: string[], varItem: { type: VarType }) => void }) => (
    <button
      type="button"
      onClick={() => onChange(['node-1', 'score'], { type: VarType.number })}
    >
      pick-var
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (value: string) => void }) => (
    <button
      type="button"
      onClick={() => onChange('{{#node-1.score#}}')}
    >
      pick-reference
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInNode: ({ variables }: { variables: string[] }) => <div>{variables.join('.')}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable-tag', () => ({
  __esModule: true,
  default: ({ valueSelector }: { valueSelector: string[] }) => <div>{valueSelector.join('.')}</div>,
}))

const mockWorkflowStoreState = {
  controlPromptEditorRerenderKey: 0,
  pipelineId: undefined as string | undefined,
  setShowInputFieldPanel: vi.fn(),
}

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof mockWorkflowStoreState) => unknown) => selector(mockWorkflowStoreState),
  useWorkflowStore: () => ({
    getState: () => ({
      ...mockWorkflowStoreState,
      conversationVariables: [],
      dataSourceList: [],
      setControlPromptEditorRerenderKey: vi.fn(),
    }),
  }),
}))

vi.mock('../../variable-assigner/hooks', () => ({
  useGetAvailableVars: () => () => [
    {
      nodeId: 'node-1',
      title: 'Start Node',
      vars: [
        {
          variable: 'score',
          type: VarType.number,
        },
      ],
    },
  ],
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string, onChange: (value: string) => void }) => (
    <textarea
      aria-label="code-editor"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
    warning: (message: string) => mockToastNotify({ type: 'warning', message }),
    info: (message: string) => mockToastNotify({ type: 'info', message }),
  },
}))

vi.mock('../../_base/components/input-number-with-slider', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: number, onChange: (value: number) => void }) => (
    <input
      aria-label="loop-count"
      type="number"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
    />
  ),
}))

vi.mock('../../_base/components/split', () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => <div data-testid="split" className={className} />,
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createCondition = (overrides: Partial<Condition> = {}): Condition => ({
  id: 'condition-1',
  varType: VarType.string,
  variable_selector: ['node-1', 'answer'],
  comparison_operator: ComparisonOperator.contains,
  value: 'hello',
  ...overrides,
})

const createLoopVariable = (overrides: Partial<LoopVariable> = {}): LoopVariable => ({
  id: 'loop-var-1',
  label: 'item',
  var_type: VarType.string,
  value_type: ValueType.constant,
  value: 'value',
  ...overrides,
})

const createNodeOutputVar = (vars: NodeOutPutVar['vars']): NodeOutPutVar => ({
  nodeId: 'node-1',
  title: 'Start Node',
  vars,
})

const createData = (overrides: Partial<LoopNodeType> = {}): LoopNodeType => ({
  title: 'Loop',
  desc: '',
  type: BlockEnum.Loop,
  start_node_id: 'start-node',
  loop_id: 'loop-node',
  logical_operator: LogicalOperator.and,
  break_conditions: [createCondition()],
  loop_count: 3,
  error_handle_mode: ErrorHandleMode.ContinueOnError,
  loop_variables: [createLoopVariable()],
  _children: [],
  isInIteration: false,
  isInLoop: false,
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  filterInputVar: vi.fn(() => true),
  childrenNodeVars: [createNodeOutputVar([{ variable: 'answer', type: VarType.string }])],
  loopChildrenNodes: [
    {
      id: 'node-1',
      data: {
        title: 'Start Node',
        type: BlockEnum.Start,
      },
    } as ReturnType<typeof useConfig>['loopChildrenNodes'][number],
  ],
  handleAddCondition: vi.fn(),
  handleRemoveCondition: vi.fn(),
  handleUpdateCondition: vi.fn(),
  handleToggleConditionLogicalOperator: vi.fn(),
  handleAddSubVariableCondition: vi.fn(),
  handleUpdateSubVariableCondition: vi.fn(),
  handleRemoveSubVariableCondition: vi.fn(),
  handleToggleSubVariableConditionLogicalOperator: vi.fn(),
  handleUpdateLoopCount: vi.fn(),
  changeErrorResponseMode: vi.fn(),
  handleAddLoopVariable: vi.fn(),
  handleRemoveLoopVariable: vi.fn(),
  handleUpdateLoopVariable: vi.fn(),
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

describe('loop path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleNodeAdd.mockReset()
    mockHandleNodeLoopRerender.mockReset()
    mockWorkflowStoreState.controlPromptEditorRerenderKey = 0
    mockWorkflowStoreState.pipelineId = undefined
    mockWorkflowStoreState.setShowInputFieldPanel = vi.fn()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Condition controls', () => {
    it('should add a condition variable from the selector', async () => {
      const user = userEvent.setup()
      const onSelectVariable = vi.fn()

      render(
        <ConditionAdd
          variables={[createNodeOutputVar([{ variable: 'score', type: VarType.number }])]}
          onSelectVariable={onSelectVariable}
        />,
      )

      await user.click(screen.getByRole('button', { name: /workflow.nodes.ifElse.addCondition/i }))
      await user.click(screen.getByText('pick-var'))

      expect(onSelectVariable).toHaveBeenCalledWith(['node-1', 'score'], { type: VarType.number })
    })

    it('should switch operators and number input modes', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const onNumberVarTypeChange = vi.fn()
      const onValueChange = vi.fn()

      render(
        <div>
          <ConditionOperator
            varType={VarType.string}
            value={ComparisonOperator.contains}
            onSelect={onSelect}
          />
          <ConditionNumberInput
            value="12"
            numberVarType={NumberVarType.constant}
            onNumberVarTypeChange={onNumberVarTypeChange}
            onValueChange={onValueChange}
            variables={[createNodeOutputVar([{ variable: 'score', type: VarType.number }])]}
            unit="%"
          />
        </div>,
      )

      await user.click(screen.getByRole('button', { name: /contains/i }))
      await user.click(screen.getByText('workflow.nodes.ifElse.comparisonOperator.is'))
      await user.click(screen.getByRole('button', { name: /constant/i }))
      await user.click(screen.getByText('Variable'))
      fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '42' } })

      expect(onSelect).toHaveBeenCalledWith(ComparisonOperator.is)
      expect(onNumberVarTypeChange).toHaveBeenCalledWith(NumberVarType.variable)
      expect(onValueChange).toHaveBeenCalledWith('42')
    })

    it('should toggle logical operators for a condition list with boolean conditions', async () => {
      const user = userEvent.setup()
      const onToggleConditionLogicalOperator = vi.fn()

      render(
        <ConditionList
          conditions={[
            createCondition({
              id: 'condition-1',
              varType: VarType.boolean,
              comparison_operator: ComparisonOperator.is,
              value: true,
            }),
            createCondition({
              id: 'condition-2',
              varType: VarType.boolean,
              comparison_operator: ComparisonOperator.is,
              value: false,
            }),
          ]}
          logicalOperator={LogicalOperator.and}
          nodeId="loop-node"
          availableNodes={[]}
          numberVariables={[]}
          availableVars={[]}
          onToggleConditionLogicalOperator={onToggleConditionLogicalOperator}
        />,
      )

      await user.click(screen.getByText('AND'))

      expect(onToggleConditionLogicalOperator).toHaveBeenCalled()
    })

    it('should render condition values, file sub-conditions, and select updates', async () => {
      const onUpdateCondition = vi.fn()
      const onRemoveCondition = vi.fn()
      const onAddSubVariableCondition = vi.fn()

      render(
        <div>
          <ConditionValue
            variableSelector={['node-1', 'answer']}
            operator={ComparisonOperator.contains}
            value="{{#node-1.answer#}}"
          />
          <ConditionFilesListValue
            condition={{
              id: 'condition-files',
              varType: VarType.object,
              variable_selector: ['node-1', 'files'],
              comparison_operator: ComparisonOperator.contains,
              value: '',
              sub_variable_condition: {
                logical_operator: LogicalOperator.or,
                conditions: [
                  {
                    id: 'sub-condition',
                    key: 'name',
                    varType: VarType.string,
                    comparison_operator: ComparisonOperator.contains,
                    value: 'report',
                  },
                ],
              },
            }}
          />
          <ConditionItem
            conditionId="condition-select"
            condition={{
              id: 'condition-select',
              key: 'type',
              varType: VarType.string,
              comparison_operator: ComparisonOperator.in,
              value: ['pdf'],
            }}
            isSubVariableKey
            nodeId="loop-node"
            availableNodes={[]}
            numberVariables={[]}
            availableVars={[]}
            onUpdateSubVariableCondition={vi.fn()}
            onRemoveSubVariableCondition={vi.fn()}
            onAddSubVariableCondition={onAddSubVariableCondition}
          />
          <ConditionItem
            conditionId="condition-string"
            condition={createCondition({ id: 'condition-string', value: 'draft' })}
            nodeId="loop-node"
            availableNodes={[]}
            numberVariables={[]}
            availableVars={[]}
            onUpdateCondition={onUpdateCondition}
            onRemoveCondition={onRemoveCondition}
          />
        </div>,
      )

      expect(screen.getAllByText('node-1.answer')).toHaveLength(2)
      expect(screen.getByText('{{answer}}')).toBeInTheDocument()
      expect(screen.getByText('node-1.files')).toBeInTheDocument()
      expect(screen.getByText('name')).toBeInTheDocument()
      expect(screen.getByText('report')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()

      expect(onUpdateCondition).not.toHaveBeenCalled()
      expect(onRemoveCondition).not.toHaveBeenCalled()
    })
  })

  describe('Loop variables', () => {
    it('should render empty state and update loop variable items', async () => {
      const user = userEvent.setup()
      const handleRemoveLoopVariable = vi.fn()
      const handleUpdateLoopVariable = vi.fn()

      const { rerender } = render(
        <LoopVariables
          variables={[]}
          nodeId="loop-node"
          handleRemoveLoopVariable={handleRemoveLoopVariable}
          handleUpdateLoopVariable={handleUpdateLoopVariable}
        />,
      )

      expect(screen.getByText('workflow.nodes.loop.setLoopVariables')).toBeInTheDocument()

      rerender(
        <LoopVariables
          variables={[createLoopVariable({
            value_type: ValueType.variable,
            value: '',
          })]}
          nodeId="loop-node"
          handleRemoveLoopVariable={handleRemoveLoopVariable}
          handleUpdateLoopVariable={handleUpdateLoopVariable}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('item'), { target: { value: 'loop_item' } })
      await user.click(screen.getByText('pick-reference'))
      await user.click(screen.getAllByRole('button').at(-1)!)

      expect(handleUpdateLoopVariable).toHaveBeenCalledWith('loop-var-1', { label: 'loop_item' })
      expect(handleUpdateLoopVariable).toHaveBeenCalledWith('loop-var-1', { value: '{{#node-1.score#}}' })
      expect(handleRemoveLoopVariable).toHaveBeenCalledWith('loop-var-1')
    })

    it('should render variable mode, variable type, and form values', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <div>
          <InputModeSelect
            value={ValueType.constant}
            onChange={vi.fn()}
          />
          <VariableTypeSelect
            value={VarType.string}
            onChange={vi.fn()}
          />
          <FormItem
            nodeId="loop-node"
            item={createLoopVariable({
              value_type: ValueType.constant,
              var_type: VarType.arrayBoolean,
              value: [false],
            })}
            onChange={onChange}
          />
        </div>,
      )

      expect(screen.getByText('Constant')).toBeInTheDocument()
      expect(screen.getByText('String')).toBeInTheDocument()
      await user.click(screen.getByText('True'))
      await user.click(screen.getByRole('button', { name: /workflow.chatVariable.modal.addArrayValue/i }))

      expect(onChange).toHaveBeenCalledWith([true])
      expect(onChange).toHaveBeenCalledWith([false, false])
    })

    it('should edit string and object loop variable values', () => {
      const onStringChange = vi.fn()
      const onObjectChange = vi.fn()

      render(
        <div>
          <FormItem
            nodeId="loop-node"
            item={createLoopVariable({
              id: 'loop-var-string',
              var_type: VarType.string,
              value_type: ValueType.constant,
              value: 'draft',
            })}
            onChange={onStringChange}
          />
          <FormItem
            nodeId="loop-node"
            item={createLoopVariable({
              id: 'loop-var-object',
              var_type: VarType.arrayObject,
              value_type: ValueType.constant,
              value: '[{\"id\":1}]',
            })}
            onChange={onObjectChange}
          />
        </div>,
      )

      fireEvent.change(screen.getByDisplayValue('draft'), { target: { value: 'published' } })
      fireEvent.change(screen.getByLabelText('code-editor'), { target: { value: '[{\"id\":2}]' } })

      expect(onStringChange).toHaveBeenCalledWith('published')
      expect(onObjectChange).toHaveBeenCalledWith('[{"id":2}]')
    })
  })

  describe('Node actions', () => {
    it('should add and insert loop blocks', async () => {
      const user = userEvent.setup()

      render(
        <div>
          <AddBlock
            loopNodeId="loop-node"
            loopNodeData={createData({ start_node_id: 'start-node' })}
          />
          <InsertBlock
            startNodeId="start-node"
            availableBlocksTypes={[BlockEnum.Code]}
          />
        </div>,
      )

      await user.click(screen.getAllByText('select-block')[0]!)
      await user.click(screen.getAllByText('select-block')[1]!)

      expect(mockHandleNodeAdd).toHaveBeenCalledTimes(2)
      expect(mockHandleNodeAdd).toHaveBeenCalledWith(expect.objectContaining({
        nodeType: expect.any(String),
      }), expect.objectContaining({
        prevNodeId: 'start-node',
        prevNodeSourceHandle: 'source',
      }))
      expect(mockHandleNodeAdd).toHaveBeenCalledWith(expect.objectContaining({
        nodeType: expect.any(String),
      }), expect.objectContaining({
        nextNodeId: 'start-node',
        nextNodeTargetHandle: 'target',
      }))
    })

    it('should render loop node candidate state and rerender children', () => {
      render(
        <Node
          id="loop-node"
          data={createData({
            _isCandidate: true,
            _children: [{ nodeId: 'child-1', nodeType: BlockEnum.LoopStart }],
          })}
        />,
      )

      expect(screen.getByText('loop-start-node')).toBeInTheDocument()
      expect(screen.getByTestId('loop-background-loop-node')).toBeInTheDocument()
      expect(screen.getByText('select-block')).toBeInTheDocument()
      expect(mockHandleNodeLoopRerender).toHaveBeenCalledWith('loop-node')
    })
  })

  describe('Panel integration', () => {
    it('should add loop variables and update loop count from the panel', async () => {
      const handleAddLoopVariable = vi.fn()
      const handleUpdateLoopCount = vi.fn()

      mockUseConfig.mockReturnValueOnce(createConfigResult({
        inputs: createData({
          break_conditions: [],
          loop_variables: [],
        }),
        handleAddLoopVariable,
        handleUpdateLoopCount,
      }))

      const { container } = render(
        <Panel
          id="loop-node"
          data={createData({
            break_conditions: [],
            loop_variables: [],
          })}
          panelProps={panelProps}
        />,
      )

      fireEvent.click(container.querySelector('.mr-4.flex.h-5.w-5.cursor-pointer.items-center.justify-center') as HTMLElement)
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } })

      expect(handleAddLoopVariable).toHaveBeenCalled()
      expect(handleUpdateLoopCount).toHaveBeenCalledWith(8)
      expect(screen.getByText('workflow.nodes.loop.setLoopVariables')).toBeInTheDocument()
    })
  })
})
