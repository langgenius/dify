import type { ListFilterNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { isSystemVar } from '../../_base/components/variable/utils'
import Node from '../node'
import { OrderBy } from '../types'

vi.mock('reactflow', () => ({
  useNodes: vi.fn(),
}))

vi.mock('../../_base/components/variable/utils', () => ({
  isSystemVar: vi.fn(),
}))

vi.mock('../../_base/components/variable/variable-label', () => ({
  VariableLabelInNode: (props: {
    variables: string[]
    nodeType?: BlockEnum
    nodeTitle?: string
  }) => (
    <div>{`${props.nodeTitle || 'missing'}:${props.nodeType || 'missing'}:${props.variables.join('.')}`}</div>
  ),
}))

const mockUseNodes = vi.mocked(useNodes)
const mockIsSystemVar = vi.mocked(isSystemVar)

const createData = (overrides: Partial<ListFilterNodeType> = {}): ListFilterNodeType => ({
  title: 'List Operator',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['answer-node', 'items'],
  var_type: VarType.arrayString,
  item_var_type: VarType.string,
  filter_by: {
    enabled: true,
    conditions: [{
      key: 'name',
      comparison_operator: 'contains' as never,
      value: '',
    }],
  },
  extract_by: {
    enabled: false,
    serial: '',
  },
  order_by: {
    enabled: true,
    key: 'name',
    value: OrderBy.ASC,
  },
  limit: {
    enabled: true,
    size: 10,
  },
  ...overrides,
})

describe('list-operator/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSystemVar.mockReturnValue(false)
    mockUseNodes.mockReturnValue([
      {
        id: 'answer-node',
        data: {
          title: 'Answer',
          type: BlockEnum.Answer,
        },
      },
      {
        id: 'start-node',
        data: {
          title: 'Start',
          type: BlockEnum.Start,
        },
      },
    ] as never)
  })

  it('renders the referenced node variable label', () => {
    render(
      <Node
        id="list-node"
        data={createData()}
      />,
    )

    expect(screen.getByText('workflow.nodes.listFilter.inputVar')).toBeInTheDocument()
    expect(screen.getByText('Answer:answer:answer-node.items')).toBeInTheDocument()
  })

  it('resolves system variables through the start node', () => {
    mockIsSystemVar.mockReturnValue(true)

    render(
      <Node
        id="list-node"
        data={createData({
          variable: ['sys', 'files'],
        })}
      />,
    )

    expect(screen.getByText('Start:start:sys.files')).toBeInTheDocument()
  })

  it('returns null when no input variable is configured', () => {
    const { container } = render(
      <Node
        id="list-node"
        data={createData({
          variable: [],
        })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
