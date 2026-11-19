import type { VariableAssignerNodeType } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createNode,
  createStartNode,
  resetFixtureCounters,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import NodeGroupItem from '../node-group-item'

const mockGetAvailableVars = vi.hoisted(() => vi.fn())
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useGetAvailableVars: () => mockGetAvailableVars,
}))

const createData = (): VariableAssignerNodeType => ({
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

  it('tracks the hovered group while connecting and clears it when the pointer leaves', async () => {
    const user = userEvent.setup()
    const data = createData()
    const { store } = renderWorkflowFlowComponent(
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
          },
          connectingNodePayload: {
            nodeId: 'source-node',
            nodeType: BlockEnum.Answer,
            handleType: 'source',
            handleId: 'source',
          },
          hoveringAssignVariableGroupId: undefined,
        },
      },
    )

    expect(screen.getByText('workflowLogic.nodes.variableAssigner.varNotSet')).toBeInTheDocument()
    const groupTitle = screen.getByText('Group A')
    await user.hover(groupTitle)
    expect(store.getState().hoveringAssignVariableGroupId).toBe('group-1')
    await user.unhover(groupTitle)
    expect(store.getState().hoveringAssignVariableGroupId).toBeUndefined()
  })

  it('renders system and node variables with their source names', () => {
    const data = createData()
    renderWorkflowFlowComponent(
      <NodeGroupItem
        item={{
          groupEnabled: true,
          targetHandleId: 'group-2',
          title: 'Group B',
          type: 'number',
          variables: [
            ['sys', 'query'],
            ['source-node', 'answer'],
          ],
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

    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText('Source Node')).toBeInTheDocument()
    expect(screen.getByText('answer')).toBeInTheDocument()
  })
})
