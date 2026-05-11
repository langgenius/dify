import { fireEvent, screen } from '@testing-library/react'
import { createNode, createStartNode, resetFixtureCounters } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import NodeGroupItem from '../node-group-item'

const mockHandleAssignVariableValueChange = vi.hoisted(() => vi.fn())
const mockHandleGroupItemMouseEnter = vi.hoisted(() => vi.fn())
const mockHandleGroupItemMouseLeave = vi.hoisted(() => vi.fn())
const mockGetAvailableVars = vi.hoisted(() => vi.fn())

vi.mock('../../hooks', () => ({
  useVariableAssigner: () => ({
    handleAssignVariableValueChange: mockHandleAssignVariableValueChange,
    handleGroupItemMouseEnter: mockHandleGroupItemMouseEnter,
    handleGroupItemMouseLeave: mockHandleGroupItemMouseLeave,
  }),
  useGetAvailableVars: () => mockGetAvailableVars,
}))

const createData = () => ({
  title: 'Variable Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  output_type: VarType.any,
  variables: [],
  advanced_settings: {
    group_enabled: true,
    groups: [
      {
        group_name: 'Group A',
        groupId: 'group-1',
        output_type: VarType.string,
        variables: [],
      },
      {
        group_name: 'Group B',
        groupId: 'group-2',
        output_type: VarType.number,
        variables: [],
      },
    ],
  },
})

const assignerNode = createNode({
  id: 'assigner-node',
  data: createData(),
})

const sourceNode = createNode({
  id: 'source-node',
  data: {
    type: BlockEnum.Answer,
    title: 'Source Node',
  },
})

const startNode = createStartNode({
  id: 'start-node',
})

describe('variable-assigner/node-group-item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFixtureCounters()
    mockGetAvailableVars.mockReturnValue([])
  })

  it('shows the selected border for the active group and forwards hover events', () => {
    const data = createData()
    const { container } = renderWorkflowFlowComponent(
      <NodeGroupItem
        item={{
          groupEnabled: true,
          targetHandleId: 'group-1',
          title: 'Group A',
          type: 'string',
          variables: [],
          variableAssignerNodeId: 'assigner-node',
          variableAssignerNodeData: data,
        }}
      />,
      {
        nodes: [assignerNode, sourceNode, startNode],
        edges: [],
        initialStoreState: {
          enteringNodePayload: {
            nodeId: 'assigner-node',
            nodeData: data,
          } as never,
          hoveringAssignVariableGroupId: 'group-1',
        },
      },
    )

    expect(screen.getByText('workflow.nodes.variableAssigner.varNotSet'))!.toBeInTheDocument()
    expect(container.querySelector('.relative.rounded-lg'))!.toHaveClass('border-text-accent!')
    expect(mockGetAvailableVars).toHaveBeenCalledWith(
      'assigner-node',
      'group-1',
      expect.any(Function),
      true,
    )

    const filter = mockGetAvailableVars.mock.calls[0]![2] as (payload: { type: VarType }) => boolean
    expect(filter({ type: VarType.string })).toBe(true)
    expect(filter({ type: VarType.number })).toBe(false)

    const groupCard = container.querySelector('.relative.rounded-lg') as HTMLElement
    fireEvent.mouseEnter(groupCard)
    fireEvent.mouseLeave(groupCard)

    expect(mockHandleGroupItemMouseEnter).toHaveBeenCalledWith('group-1')
    expect(mockHandleGroupItemMouseLeave).toHaveBeenCalledTimes(1)
  })

  it('shows the selection border for non-primary groups and renders system and node variables', () => {
    const data = createData()
    const { container } = renderWorkflowFlowComponent(
      <NodeGroupItem
        item={{
          groupEnabled: true,
          targetHandleId: 'group-2',
          title: 'Group B',
          type: 'number',
          variables: [['sys', 'query'], ['source-node', 'answer']],
          variableAssignerNodeId: 'assigner-node',
          variableAssignerNodeData: data,
        }}
      />,
      {
        nodes: [assignerNode, sourceNode, startNode],
        edges: [],
        initialStoreState: {
          enteringNodePayload: {
            nodeId: 'assigner-node',
            nodeData: data,
          } as never,
          hoveringAssignVariableGroupId: undefined,
        },
      },
    )

    expect(container.querySelector('.relative.rounded-lg'))!.toHaveClass('border-dashed!')
    expect(screen.getByText('Start'))!.toBeInTheDocument()
    expect(screen.getByText('query'))!.toBeInTheDocument()
    expect(screen.getByText('Source Node'))!.toBeInTheDocument()
    expect(screen.getByText('answer'))!.toBeInTheDocument()

    const filter = mockGetAvailableVars.mock.calls[0]![2] as (payload: { type: VarType }) => boolean
    expect(filter({ type: VarType.number })).toBe(true)
    expect(filter({ type: VarType.string })).toBe(false)
  })

  it('uses the root output type when grouping is disabled and keeps the border state neutral', () => {
    const data = createData()
    data.output_type = VarType.boolean

    const { container } = renderWorkflowFlowComponent(
      <NodeGroupItem
        item={{
          groupEnabled: false,
          targetHandleId: 'group-1',
          title: 'Ungrouped',
          type: 'boolean',
          variables: [],
          variableAssignerNodeId: 'assigner-node',
          variableAssignerNodeData: data,
        }}
      />,
      {
        nodes: [assignerNode, sourceNode, startNode],
        edges: [],
      },
    )

    expect(container.querySelector('.relative.rounded-lg')).not.toHaveClass('border-dashed!')
    expect(container.querySelector('.relative.rounded-lg')).not.toHaveClass('border-text-accent!')

    const filter = mockGetAvailableVars.mock.calls[0]![2] as (payload: { type: VarType }) => boolean
    expect(filter({ type: VarType.boolean })).toBe(true)
    expect(filter({ type: VarType.string })).toBe(false)
  })
})
