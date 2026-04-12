import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'
import { AssignerNodeInputType, WriteMode } from '../types'

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useNodes: vi.fn(),
  }
})

vi.mock('@/app/components/workflow/nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInNode: ({
    variables,
    nodeTitle,
    nodeType,
    rightSlot,
  }: {
    variables: string[]
    nodeTitle?: string
    nodeType?: BlockEnum
    rightSlot?: React.ReactNode
  }) => (
    <div>
      <span>{`${nodeTitle}:${nodeType}:${variables.join('.')}`}</span>
      {rightSlot}
    </div>
  ),
}))

const mockUseNodes = vi.mocked(useNodes)

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

describe('assigner/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodes.mockReturnValue([
      {
        id: 'node-1',
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
    ] as ReturnType<typeof useNodes>)
  })

  it('renders the empty-state hint when no assignable variable is configured', () => {
    render(
      <Node
        id="assigner-node"
        data={createData({
          items: [createOperation({ variable_selector: [] })],
        })}
      />,
    )

    expect(screen.getByText('workflow.nodes.assigner.varNotSet')).toBeInTheDocument()
  })

  it('renders both version 2 and legacy previews with resolved node labels', () => {
    const { container, rerender } = render(
      <Node
        id="assigner-node"
        data={createData()}
      />,
    )

    expect(screen.getByText('Answer:answer:node-1.count')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.over-write')).toBeInTheDocument()

    rerender(
      <Node
        id="assigner-node"
        data={{
          title: 'Legacy Assigner',
          desc: '',
          type: BlockEnum.VariableAssigner,
          assigned_variable_selector: ['sys', 'query'],
          write_mode: WriteMode.append,
        } as unknown as AssignerNodeType}
      />,
    )

    expect(screen.getByText('Start:start:sys.query')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.append')).toBeInTheDocument()

    rerender(
      <Node
        id="assigner-node"
        data={{
          title: 'Legacy Assigner',
          desc: '',
          type: BlockEnum.VariableAssigner,
          assigned_variable_selector: [],
          write_mode: WriteMode.append,
        } as unknown as AssignerNodeType}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('skips empty v2 operations and resolves system variables through the start node', () => {
    render(
      <Node
        id="assigner-node"
        data={createData({
          items: [
            createOperation({ variable_selector: [] }),
            createOperation({
              variable_selector: ['sys', 'query'],
              operation: WriteMode.append,
            }),
          ],
        })}
      />,
    )

    expect(screen.getByText('Start:start:sys.query')).toBeInTheDocument()
    expect(screen.queryByText('undefined:undefined:')).not.toBeInTheDocument()
  })
})
