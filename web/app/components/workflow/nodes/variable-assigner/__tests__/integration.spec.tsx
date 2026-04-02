/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { VariableAssignerNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/components/base/ui/toast'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import AddVariable from '../components/add-variable'
import NodeGroupItem from '../components/node-group-item'
import NodeVariableItem from '../components/node-variable-item'
import VarGroupItem from '../components/var-group-item'
import VarList from '../components/var-list'
import Panel from '../panel'
import useConfig from '../use-config'

const mockHandleAssignVariableValueChange = vi.fn()
const mockHandleGroupItemMouseEnter = vi.fn()
const mockHandleGroupItemMouseLeave = vi.fn()
const mockGetAvailableVars = vi.fn()

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/add-variable-popup', () => ({
  default: ({ onSelect }: any) => (
    <button
      type="button"
      onClick={() => onSelect(['source-node', 'pickedVar'], { variable: 'pickedVar', type: VarType.string })}
    >
      confirm-add-variable
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ value, onChange, isAddBtnTrigger, onOpen, placeholder }: any) => (
    <div>
      <div>{Array.isArray(value) ? value.join('.') : ''}</div>
      <button
        type="button"
        onClick={() => {
          onOpen?.()
          if (isAddBtnTrigger)
            onChange(['source-node', 'groupVar'], 'variable', { variable: 'groupVar', type: VarType.string })
          else
            onChange(['source-node', 'updatedVar'])
        }}
      >
        {isAddBtnTrigger ? 'add-variable-from-picker' : (placeholder || 'pick-var')}
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/remove-button', () => ({
  default: ({ onClick }: any) => <button type="button" onClick={onClick}>remove-variable</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, operations, children, className }: any) => <div className={className}><div>{title}</div><div>{operations}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children }: any) => <div>{children}</div>,
  VarItem: ({ name, type, description }: any) => <div>{`${name}:${type}:${description}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm', () => ({
  default: ({ isShow, onCancel, onConfirm }: any) => isShow
    ? (
        <div>
          <button type="button" onClick={onCancel}>cancel-remove</button>
          <button type="button" onClick={onConfirm}>confirm-remove</button>
        </div>
      )
    : null,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInNode: ({ variables, nodeTitle, isExceptionVariable }: any) => (
    <div>{`${nodeTitle}:${variables.join('.')}:${String(Boolean(isExceptionVariable))}`}</div>
  ),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  VarBlockIcon: ({ type }: any) => <div>{`block-icon:${type}`}</div>,
}))

vi.mock('../hooks', () => ({
  useVariableAssigner: () => ({
    handleAssignVariableValueChange: mockHandleAssignVariableValueChange,
    handleGroupItemMouseEnter: mockHandleGroupItemMouseEnter,
    handleGroupItemMouseLeave: mockHandleGroupItemMouseLeave,
  }),
  useGetAvailableVars: () => mockGetAvailableVars,
}))

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)
const mockToastError = vi.mocked(toast.error)

const createData = (overrides: Partial<VariableAssignerNodeType> = {}): VariableAssignerNodeType => ({
  title: 'Variable Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  output_type: VarType.string,
  variables: [['source-node', 'initialVar']],
  advanced_settings: {
    group_enabled: true,
    groups: [
      {
        groupId: 'group-1',
        group_name: 'Group1',
        output_type: VarType.string,
        variables: [['source-node', 'initialVar']],
      },
      {
        groupId: 'group-2',
        group_name: 'Group2',
        output_type: VarType.number,
        variables: [],
      },
    ],
  },
  selected: false,
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  handleListOrTypeChange: vi.fn(),
  isEnableGroup: true,
  handleGroupEnabledChange: vi.fn(),
  handleAddGroup: vi.fn(),
  handleListOrTypeChangeInGroup: vi.fn(() => vi.fn()),
  handleGroupRemoved: vi.fn(() => vi.fn()),
  handleVarGroupNameChange: vi.fn(() => vi.fn()),
  isShowRemoveVarConfirm: false,
  hideRemoveVarConfirm: vi.fn(),
  onRemoveVarConfirm: vi.fn(),
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

describe('variable-assigner path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAvailableVars.mockReturnValue([
      {
        nodeId: 'source-node',
        title: 'Source Node',
        vars: [{ variable: 'pickedVar', type: VarType.string }],
      },
    ])
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Path Integration', () => {
    it('should open the add-variable popup and assign a selected value', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <AddVariable
          availableVars={[]}
          variableAssignerNodeId="assigner-node"
          variableAssignerNodeData={createData({ selected: true })}
          handleId="group-1"
        />,
      )

      await user.click(container.querySelector('.h-4.w-4.cursor-pointer') as HTMLElement)
      await user.click(screen.getByRole('button', { name: 'confirm-add-variable' }))

      expect(mockHandleAssignVariableValueChange).toHaveBeenCalledWith(
        'assigner-node',
        ['source-node', 'pickedVar'],
        { variable: 'pickedVar', type: VarType.string },
        'group-1',
      )
    })

    it('should render node variable labels for env, system, and rag variables', () => {
      const node = {
        id: 'source-node',
        data: { title: 'Source Node', type: BlockEnum.Answer },
      } as any
      const { rerender, container } = render(
        <NodeVariableItem
          node={node}
          variable={['env', 'API_KEY']}
          writeMode="append"
        />,
      )

      expect(container).toHaveTextContent('Source Node')
      expect(container).toHaveTextContent('API_KEY')
      expect(container).toHaveTextContent('workflow.nodes.assigner.operations.append')

      rerender(
        <NodeVariableItem
          node={node}
          variable={['sys', 'query']}
          isException
        />,
      )
      expect(container).toHaveTextContent('sys.query')

      rerender(
        <NodeVariableItem
          node={node}
          variable={['rag', 'metadata']}
        />,
      )
      expect(container).toHaveTextContent('metadata')
    })

    it('should render, update, and remove variables in the list', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onOpen = vi.fn()
      const { rerender } = render(
        <VarList
          readonly={false}
          nodeId="assigner-node"
          list={[]}
          onChange={onChange}
        />,
      )

      expect(screen.getByText('workflow.nodes.variableAssigner.noVarTip')).toBeInTheDocument()

      rerender(
        <VarList
          readonly={false}
          nodeId="assigner-node"
          list={[['source-node', 'initialVar']]}
          onChange={onChange}
          onOpen={onOpen}
          filterVar={vi.fn(() => true)}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'pick-var' }))
      expect(onOpen).toHaveBeenCalledWith(0)
      expect(onChange).toHaveBeenLastCalledWith([['source-node', 'updatedVar']], ['source-node', 'updatedVar'])

      await user.click(screen.getByRole('button', { name: 'remove-variable' }))
      expect(onChange).toHaveBeenLastCalledWith([])
    })

    it('should add group variables, validate group names, and allow removing the group', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onGroupNameChange = vi.fn()
      const onRemove = vi.fn()

      const { container } = render(
        <VarGroupItem
          readOnly={false}
          nodeId="assigner-node"
          payload={{
            group_name: 'Group1',
            output_type: VarType.any,
            variables: [],
          }}
          onChange={onChange}
          groupEnabled
          onGroupNameChange={onGroupNameChange}
          canRemove
          onRemove={onRemove}
          availableVars={[]}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'add-variable-from-picker' }))
      expect(onChange).toHaveBeenCalledWith({
        group_name: 'Group1',
        output_type: VarType.string,
        variables: [['source-node', 'groupVar']],
      })

      await user.click(screen.getByText('Group1'))
      fireEvent.change(screen.getByDisplayValue('Group1'), { target: { value: '1bad' } })
      expect(mockToastError).toHaveBeenCalled()

      fireEvent.change(screen.getByDisplayValue('Group1'), { target: { value: 'Renamed Group' } })
      expect(onGroupNameChange).toHaveBeenCalledWith('Renamed_Group')

      await user.click(container.querySelector('.cursor-pointer.rounded-md') as HTMLElement)
      expect(onRemove).toHaveBeenCalledTimes(1)
    })

    it('should ignore duplicate group variables and reset the output type when the group becomes empty', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(
        <VarGroupItem
          readOnly={false}
          nodeId="assigner-node"
          payload={{
            group_name: 'Group1',
            output_type: VarType.string,
            variables: [['source-node', 'groupVar']],
          }}
          onChange={onChange}
          groupEnabled
          availableVars={[]}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'add-variable-from-picker' }))
      expect(onChange).not.toHaveBeenCalled()

      rerender(
        <VarGroupItem
          readOnly={false}
          nodeId="assigner-node"
          payload={{
            group_name: 'Group1',
            output_type: VarType.string,
            variables: [['source-node', 'updatedVar']],
          }}
          onChange={onChange}
          groupEnabled
          availableVars={[]}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'pick-var' }))
      expect(onChange).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'remove-variable' }))
      expect(onChange).toHaveBeenLastCalledWith({
        group_name: 'Group1',
        output_type: VarType.any,
        variables: [],
      })

      rerender(
        <VarGroupItem
          readOnly
          nodeId="assigner-node"
          payload={{
            output_type: VarType.any,
            variables: [],
          }}
          onChange={onChange}
          groupEnabled={false}
          availableVars={[]}
        />,
      )

      expect(screen.getByText('workflow.nodes.variableAssigner.title')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'add-variable-from-picker' })).not.toBeInTheDocument()
    })

    it('should render empty and populated node groups with hover states', async () => {
      const user = userEvent.setup()
      const selectedData = createData()
      const { container, rerender } = renderWorkflowFlowComponent(
        <NodeGroupItem
          item={{
            groupEnabled: true,
            targetHandleId: 'group-1',
            title: 'Group1',
            type: 'string',
            variables: [],
            variableAssignerNodeId: 'assigner-node',
            variableAssignerNodeData: selectedData,
          }}
        />,
        {
          nodes: [
            { id: 'source-node', position: { x: 0, y: 0 }, data: { title: 'Source Node', type: BlockEnum.Answer } as any },
          ],
          edges: [],
          initialStoreState: {
            enteringNodePayload: {
              nodeId: 'assigner-node',
              nodeData: selectedData,
            } as any,
            hoveringAssignVariableGroupId: 'group-1',
          },
        },
      )

      expect(container).toHaveTextContent('workflow.nodes.variableAssigner.varNotSet')
      const groupCard = container.querySelector('.relative.rounded-lg') as HTMLElement
      expect(groupCard).toHaveClass('border-text-accent!')

      fireEvent.mouseEnter(groupCard)
      fireEvent.mouseLeave(groupCard)
      expect(mockHandleGroupItemMouseEnter).toHaveBeenCalledWith('group-1')
      expect(mockHandleGroupItemMouseLeave).toHaveBeenCalledTimes(1)

      rerender(
        <NodeGroupItem
          item={{
            groupEnabled: true,
            targetHandleId: 'group-2',
            title: 'Group2',
            type: 'string',
            variables: [['source-node', 'initialVar']],
            variableAssignerNodeId: 'assigner-node',
            variableAssignerNodeData: selectedData,
          }}
        />,
      )

      expect(container).toHaveTextContent('Source Node:source-node.initialVar:false')
      expect(container.querySelector('.relative.rounded-lg')).toHaveClass('border-dashed!')

      await user.click(container.querySelector('.h-4.w-4.cursor-pointer') as HTMLElement)
      await user.click(screen.getByRole('button', { name: 'confirm-add-variable' }))
      expect(mockHandleAssignVariableValueChange).toHaveBeenCalled()
    })

    it('should resolve default group borders without an active hover id and render exception variables', () => {
      const selectedData = createData()
      const { container, rerender } = renderWorkflowFlowComponent(
        <NodeGroupItem
          item={{
            groupEnabled: true,
            targetHandleId: 'group-2',
            title: 'Group2',
            type: 'string',
            variables: [],
            variableAssignerNodeId: 'assigner-node',
            variableAssignerNodeData: selectedData,
          }}
        />,
        {
          nodes: [
            { id: 'agent-node', position: { x: 0, y: 0 }, data: { title: 'Agent Node', type: BlockEnum.Agent } as any },
          ],
          edges: [],
          initialStoreState: {
            enteringNodePayload: {
              nodeId: 'assigner-node',
              nodeData: selectedData,
            } as any,
            hoveringAssignVariableGroupId: undefined,
          },
        },
      )

      expect(container.querySelector('.relative.rounded-lg')).toHaveClass('border-dashed!')

      rerender(
        <NodeGroupItem
          item={{
            groupEnabled: false,
            targetHandleId: 'target',
            title: 'Target',
            type: 'string',
            variables: [['agent-node', 'error_message']],
            variableAssignerNodeId: 'assigner-node',
            variableAssignerNodeData: createData({
              output_type: VarType.any,
              variables: [['agent-node', 'error_message']],
            }),
          }}
        />,
      )

      expect(container).toHaveTextContent('Agent Node:agent-node.error_message:true')
    })

    it('should render grouped and ungrouped panels and confirm removal actions', async () => {
      const user = userEvent.setup()
      const groupedConfig = createConfigResult({
        isShowRemoveVarConfirm: true,
      })
      mockUseConfig.mockReturnValue(groupedConfig)

      const { rerender } = render(
        <Panel
          id="assigner-node"
          data={createData()}
          panelProps={panelProps}
        />,
      )

      expect(screen.getByText('Group1.output:string:workflow.nodes.variableAssigner.outputVars.varDescribe:{"groupName":"Group1"}')).toBeInTheDocument()
      expect(screen.getByText('Group2.output:number:workflow.nodes.variableAssigner.outputVars.varDescribe:{"groupName":"Group2"}')).toBeInTheDocument()

      await user.click(screen.getByRole('switch'))
      expect(groupedConfig.handleGroupEnabledChange).toHaveBeenCalled()

      await user.click(screen.getByText('workflow.nodes.variableAssigner.addGroup'))
      expect(groupedConfig.handleAddGroup).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'cancel-remove' }))
      expect(groupedConfig.hideRemoveVarConfirm).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'confirm-remove' }))
      expect(groupedConfig.onRemoveVarConfirm).toHaveBeenCalledTimes(1)

      const singleConfig = createConfigResult({
        isEnableGroup: false,
        inputs: createData({
          advanced_settings: {
            group_enabled: false,
            groups: [],
          },
        }),
      })
      mockUseConfig.mockReturnValue(singleConfig)

      rerender(
        <Panel
          id="assigner-node"
          data={singleConfig.inputs}
          panelProps={panelProps}
        />,
      )

      expect(screen.queryByText('Group1.output:string:workflow.nodes.variableAssigner.outputVars.varDescribe:{"groupName":"Group1"}')).not.toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.variableAssigner.aggregationGroup')).toBeInTheDocument()
    })
  })
})
