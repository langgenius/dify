/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import OperationSelector from '../components/operation-selector'
import VarList from '../components/var-list'
import Node from '../node'
import Panel from '../panel'
import { AssignerNodeInputType, WriteMode, writeModeTypesNum } from '../types'
import useConfig from '../use-config'

const mockHandleAddOperationItem = vi.fn()

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, operations, children }: any) => <div><div>{title}</div><div>{operations}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/list-no-data-placeholder', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ value, onChange, onOpen, placeholder, popupFor, valueTypePlaceHolder, filterVar }: any) => (
    <div>
      <div>{Array.isArray(value) ? value.join('.') : String(value ?? '')}</div>
      {valueTypePlaceHolder && <div>{`type:${valueTypePlaceHolder}`}</div>}
      {popupFor === 'toAssigned' && (
        <div>{`filter:${String(filterVar?.({ nodeId: 'node-1', variable: 'count', type: VarType.string }))}:${String(filterVar?.({ nodeId: 'node-2', variable: 'other', type: VarType.string }))}`}</div>
      )}
      <button
        type="button"
        onClick={() => {
          onOpen?.()
          onChange(popupFor === 'assigned' ? ['node-1', 'count'] : ['node-2', 'result'])
        }}
      >
        {placeholder || popupFor || 'pick-var'}
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      aria-label="code-editor"
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/app/components/workflow/panel/chat-variable-panel/components/bool-value', () => ({
  default: ({ value, onChange }: any) => (
    <button type="button" onClick={() => onChange(!value)}>
      {`bool:${String(value)}`}
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInNode: ({ variables, nodeTitle, rightSlot }: any) => (
    <div>
      <span>{nodeTitle}</span>
      <span>{variables.join('.')}</span>
      {rightSlot}
    </div>
  ),
}))

vi.mock('../hooks', () => ({
  useHandleAddOperationItem: () => mockHandleAddOperationItem,
}))

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createOperation = (overrides: Partial<AssignerNodeOperation> = {}): AssignerNodeOperation => ({
  variable_selector: ['node-1', 'count'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['node-2', 'result'],
  ...overrides,
})

const createData = (overrides: Partial<AssignerNodeType> = {}): AssignerNodeType => ({
  title: 'Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  version: '2',
  items: [createOperation()],
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  handleOperationListChanges: vi.fn(),
  getAssignedVarType: vi.fn(() => VarType.string),
  getToAssignedVarType: vi.fn(() => VarType.string),
  writeModeTypes: [WriteMode.overwrite, WriteMode.clear, WriteMode.set],
  writeModeTypesArr: [WriteMode.overwrite, WriteMode.clear, WriteMode.append, WriteMode.extend],
  writeModeTypesNum,
  filterAssignedVar: vi.fn(() => true),
  filterToAssignedVar: vi.fn(() => true),
  getAvailableVars: vi.fn(() => []),
  filterVar: vi.fn(() => vi.fn(() => true)),
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

describe('assigner path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleAddOperationItem.mockReturnValue([createOperation(), createOperation({ variable_selector: [] })])
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Path Integration', () => {
    it('should open the operation selector and choose number operations', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <OperationSelector
          value={WriteMode.overwrite}
          onSelect={onSelect}
          assignedVarType={VarType.number}
          writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
          writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
          writeModeTypesNum={[WriteMode.increment]}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.assigner.operations.over-write'))
      expect(screen.getByText('workflow.nodes.assigner.operations.clear'))!.toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.assigner.operations.set'))!.toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.assigner.operations.+='))!.toBeInTheDocument()

      await user.click(screen.getByText('workflow.nodes.assigner.operations.+='))
      expect(onSelect).toHaveBeenCalledWith({ value: WriteMode.increment, name: WriteMode.increment })
    })

    it('should not open a disabled operation selector', async () => {
      const user = userEvent.setup()

      render(
        <OperationSelector
          value={WriteMode.overwrite}
          onSelect={vi.fn()}
          disabled
          assignedVarType={VarType.string}
          writeModeTypes={[WriteMode.overwrite]}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.assigner.operations.over-write'))
      expect(screen.queryByText('workflow.nodes.assigner.operations.title')).not.toBeInTheDocument()
    })

    it('should render empty and populated variable lists across constant editors', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onOpen = vi.fn()
      const { rerender } = render(
        <VarList
          readonly={false}
          nodeId="node-1"
          list={[]}
          onChange={onChange}
        />,
      )

      expect(screen.getByText('workflow.nodes.assigner.noVarTip'))!.toBeInTheDocument()

      rerender(
        <VarList
          readonly={false}
          nodeId="node-1"
          list={[createOperation({ variable_selector: [], value: [] })]}
          onChange={onChange}
          onOpen={onOpen}
          filterVar={vi.fn(() => true)}
          filterToAssignedVar={vi.fn(() => true)}
          getAssignedVarType={vi.fn(() => VarType.string)}
          getToAssignedVarType={vi.fn(() => VarType.string)}
          writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
          writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
          writeModeTypesNum={writeModeTypesNum}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.assigner.selectAssignedVariable'))
      expect(onOpen).toHaveBeenCalledWith(0)
      expect(onChange).toHaveBeenLastCalledWith([
        {
          variable_selector: ['node-1', 'count'],
          operation: WriteMode.overwrite,
          input_type: AssignerNodeInputType.variable,
          value: undefined,
        },
      ], ['node-1', 'count'])

      onChange.mockClear()
      rerender(
        <VarList
          readonly={false}
          nodeId="node-1"
          list={[createOperation({ operation: WriteMode.overwrite, value: ['node-2', 'result'] })]}
          onChange={onChange}
          filterVar={vi.fn(() => true)}
          filterToAssignedVar={vi.fn(() => true)}
          getAssignedVarType={vi.fn(() => VarType.boolean)}
          getToAssignedVarType={vi.fn(() => VarType.string)}
          writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
          writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
          writeModeTypesNum={writeModeTypesNum}
        />,
      )

      expect(screen.getByText('filter:false:true'))!.toBeInTheDocument()
      await user.click(screen.getByText('workflow.nodes.assigner.operations.over-write'))
      await user.click(screen.getByText('workflow.nodes.assigner.operations.set'))
      expect(onChange).toHaveBeenLastCalledWith([
        createOperation({
          operation: WriteMode.set,
          input_type: AssignerNodeInputType.constant,
          value: false,
        }),
      ])

      onChange.mockClear()
      await user.click(screen.getByText('workflow.nodes.assigner.setParameter'))
      expect(onChange).toHaveBeenLastCalledWith([
        createOperation({ operation: WriteMode.overwrite, value: ['node-2', 'result'] }),
      ], ['node-2', 'result'])

      onChange.mockClear()
      rerender(
        <VarList
          readonly={false}
          nodeId="node-1"
          list={[createOperation({ operation: WriteMode.set, value: 'hello' })]}
          onChange={onChange}
          filterVar={vi.fn(() => true)}
          filterToAssignedVar={vi.fn(() => true)}
          getAssignedVarType={vi.fn(() => VarType.string)}
          getToAssignedVarType={vi.fn(() => VarType.string)}
          writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
          writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
          writeModeTypesNum={writeModeTypesNum}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'updated text' } })
      expect(onChange).toHaveBeenLastCalledWith([
        createOperation({ operation: WriteMode.set, value: 'updated text' }),
      ], 'updated text')

      onChange.mockClear()
      rerender(
        <VarList
          readonly={false}
          nodeId="node-1"
          list={[createOperation({ operation: WriteMode.set, value: 3 })]}
          onChange={onChange}
          filterVar={vi.fn(() => true)}
          filterToAssignedVar={vi.fn(() => true)}
          getAssignedVarType={vi.fn(() => VarType.number)}
          getToAssignedVarType={vi.fn(() => VarType.number)}
          writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
          writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
          writeModeTypesNum={writeModeTypesNum}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('3'), { target: { value: '5' } })
      expect(onChange).toHaveBeenLastCalledWith([
        createOperation({ operation: WriteMode.set, value: 5 }),
      ], 5)

      onChange.mockClear()
      rerender(
        <VarList
          readonly={false}
          nodeId="node-1"
          list={[createOperation({ operation: WriteMode.set, value: false })]}
          onChange={onChange}
          filterVar={vi.fn(() => true)}
          filterToAssignedVar={vi.fn(() => true)}
          getAssignedVarType={vi.fn(() => VarType.boolean)}
          getToAssignedVarType={vi.fn(() => VarType.boolean)}
          writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
          writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
          writeModeTypesNum={writeModeTypesNum}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'bool:false' }))
      expect(onChange).toHaveBeenLastCalledWith([
        createOperation({ operation: WriteMode.set, value: true }),
      ], true)

      onChange.mockClear()
      rerender(
        <VarList
          readonly={false}
          nodeId="node-1"
          list={[createOperation({ operation: WriteMode.set, value: '{\"a\":1}' })]}
          onChange={onChange}
          filterVar={vi.fn(() => true)}
          filterToAssignedVar={vi.fn(() => true)}
          getAssignedVarType={vi.fn(() => VarType.object)}
          getToAssignedVarType={vi.fn(() => VarType.object)}
          writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
          writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
          writeModeTypesNum={writeModeTypesNum}
        />,
      )

      fireEvent.change(screen.getByLabelText('code-editor'), { target: { value: '{\"a\":2}' } })
      expect(onChange).toHaveBeenLastCalledWith([
        createOperation({ operation: WriteMode.set, value: '{\"a\":2}' }),
      ], '{"a":2}')

      onChange.mockClear()
      rerender(
        <VarList
          readonly={false}
          nodeId="node-1"
          list={[createOperation({ operation: WriteMode.increment, value: 2 })]}
          onChange={onChange}
          filterVar={vi.fn(() => true)}
          filterToAssignedVar={vi.fn(() => true)}
          getAssignedVarType={vi.fn(() => VarType.number)}
          getToAssignedVarType={vi.fn(() => VarType.number)}
          writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
          writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
          writeModeTypesNum={writeModeTypesNum}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '4' } })
      expect(onChange).toHaveBeenLastCalledWith([
        createOperation({ operation: WriteMode.increment, value: 4 }),
      ], 4)

      const buttons = screen.getAllByRole('button')
      await user.click(buttons.at(-1)!)
      expect(onChange).toHaveBeenLastCalledWith([])
    })

    it('should render version 2 and legacy node previews', () => {
      const { rerender } = renderWorkflowFlowComponent(
        <Node
          id="assigner-node"
          data={createData({
            items: [createOperation({ variable_selector: [] })],
          })}
        />,
        {
          nodes: [
            { id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Answer', type: BlockEnum.Answer } as any },
            { id: 'start', position: { x: 0, y: 0 }, data: { title: 'Start', type: BlockEnum.Start } as any },
          ],
          edges: [],
        },
      )

      expect(screen.getByText('workflow.nodes.assigner.varNotSet'))!.toBeInTheDocument()

      rerender(
        <Node
          id="assigner-node"
          data={createData({
            items: [createOperation()],
          })}
        />,
      )

      expect(screen.getByText('Answer'))!.toBeInTheDocument()
      expect(screen.getByText('node-1.count'))!.toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.assigner.operations.over-write'))!.toBeInTheDocument()

      rerender(
        <Node
          id="assigner-node"
          data={{
            title: 'Legacy Assigner',
            desc: '',
            type: BlockEnum.VariableAssigner,
            assigned_variable_selector: ['sys', 'query'],
            write_mode: WriteMode.append,
          } as any}
        />,
      )

      expect(screen.getByText('Start'))!.toBeInTheDocument()
      expect(screen.getByText('sys.query'))!.toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.assigner.operations.append'))!.toBeInTheDocument()
    })

    it('should skip empty version 2 items and resolve system variables without an operation badge', () => {
      renderWorkflowFlowComponent(
        <Node
          id="assigner-node"
          data={createData({
            items: [
              createOperation({ variable_selector: [] }),
              createOperation({
                variable_selector: ['sys', 'query'],
                operation: undefined,
              }),
            ],
          })}
        />,
        {
          nodes: [
            { id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Answer', type: BlockEnum.Answer } as any },
            { id: 'start', position: { x: 0, y: 0 }, data: { title: 'Start', type: BlockEnum.Start } as any },
          ],
          edges: [],
        },
      )

      expect(screen.getByText('Start'))!.toBeInTheDocument()
      expect(screen.getByText('sys.query'))!.toBeInTheDocument()
      expect(screen.queryByText('workflow.nodes.assigner.operations.over-write')).not.toBeInTheDocument()
    })

    it('should return null for legacy nodes without assigned variables and resolve non-system legacy vars', () => {
      const { rerender } = renderWorkflowFlowComponent(
        <Node
          id="assigner-node"
          data={{
            title: 'Legacy Assigner',
            desc: '',
            type: BlockEnum.VariableAssigner,
            assigned_variable_selector: [],
            write_mode: WriteMode.append,
          } as any}
        />,
        {
          nodes: [
            { id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Answer', type: BlockEnum.Answer } as any },
            { id: 'start', position: { x: 0, y: 0 }, data: { title: 'Start', type: BlockEnum.Start } as any },
          ],
          edges: [],
        },
      )

      expect(screen.queryByText('workflow.nodes.assigner.operations.append')).not.toBeInTheDocument()
      expect(screen.queryByText('node-1.count')).not.toBeInTheDocument()

      rerender(
        <Node
          id="assigner-node"
          data={{
            title: 'Legacy Assigner',
            desc: '',
            type: BlockEnum.VariableAssigner,
            assigned_variable_selector: ['node-1', 'count'],
            write_mode: WriteMode.append,
          } as any}
        />,
      )

      expect(screen.getByText('Answer'))!.toBeInTheDocument()
      expect(screen.getByText('node-1.count'))!.toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.assigner.operations.append'))!.toBeInTheDocument()
    })

    it('should add panel operations with the real variable list inside the panel', async () => {
      const user = userEvent.setup()
      const config = createConfigResult({
        inputs: createData(),
      })
      mockUseConfig.mockReturnValue(config)

      render(
        <Panel
          id="assigner-node"
          data={createData()}
          panelProps={panelProps}
        />,
      )

      await user.click(screen.getAllByRole('button')[0]!)

      expect(mockHandleAddOperationItem).toHaveBeenCalledWith(createData().items)
      expect(config.handleOperationListChanges).toHaveBeenCalledWith([
        createOperation(),
        createOperation({ variable_selector: [] }),
      ])

      expect(screen.getByText('workflow.nodes.assigner.variables'))!.toBeInTheDocument()
      expect(screen.getByText('node-1.count'))!.toBeInTheDocument()
    })
  })
})
