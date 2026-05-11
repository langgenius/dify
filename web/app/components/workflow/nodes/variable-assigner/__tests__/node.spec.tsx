import type { VariableAssignerNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Node from '../node'

type MockNodeGroupItemProps = {
  item: {
    groupEnabled: boolean
    targetHandleId: string
    title: string
    type: VarType
    variables: string[][]
    variableAssignerNodeId: string
  }
}

const mockNodeGroupItemRender = vi.hoisted(() => vi.fn())

vi.mock('../components/node-group-item', () => ({
  __esModule: true,
  default: (props: MockNodeGroupItemProps) => {
    mockNodeGroupItemRender(props)
    return (
      <div>
        {`${props.item.title}:${props.item.targetHandleId}:${props.item.type}:${props.item.variables.map(variable => variable.join('.')).join('|')}`}
      </div>
    )
  },
}))

const createData = (overrides: Partial<VariableAssignerNodeType> = {}): VariableAssignerNodeType => ({
  title: 'Variable Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  output_type: VarType.string,
  variables: [['source-node', 'rootVar']],
  advanced_settings: {
    group_enabled: true,
    groups: [
      {
        groupId: 'group-1',
        group_name: 'Group1',
        output_type: VarType.string,
        variables: [['source-node', 'groupVar']],
      },
      {
        groupId: 'group-2',
        group_name: 'Group2',
        output_type: VarType.number,
        variables: [],
      },
    ],
  },
  ...overrides,
})

const baseNodeProps = {
  id: 'assigner-node',
  type: 'custom',
  selected: false,
  zIndex: 1,
  isConnectable: true,
  xPos: 0,
  yPos: 0,
  dragging: false,
  dragHandle: '.drag-handle',
}

describe('variable-assigner/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders grouped node cards when aggregation is enabled', () => {
    render(
      <Node
        {...baseNodeProps}
        data={createData()}
      />,
    )

    expect(screen.getByText('Group1:group-1:string:source-node.groupVar')).toBeInTheDocument()
    expect(screen.getByText('Group2:group-2:number:')).toBeInTheDocument()
    expect(mockNodeGroupItemRender).toHaveBeenCalledTimes(2)
  })

  it('renders a single root group when aggregation is disabled', () => {
    render(
      <Node
        {...baseNodeProps}
        data={createData({
          advanced_settings: {
            group_enabled: false,
            groups: [],
          },
        })}
      />,
    )

    expect(screen.getByText('workflow.nodes.variableAssigner.title:target:string:source-node.rootVar')).toBeInTheDocument()
    expect(mockNodeGroupItemRender).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({
        groupEnabled: false,
        targetHandleId: 'target',
        variableAssignerNodeId: 'assigner-node',
      }),
    }))
  })
})
