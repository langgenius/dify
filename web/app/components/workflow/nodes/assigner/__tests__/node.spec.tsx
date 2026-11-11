import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import { render as renderComponent, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { createNode } from '../../../__tests__/fixtures'
import Node from '../node'
import { AssignerNodeInputType, WriteMode } from '../types'

function Graph({ children }: { children: React.ReactNode }) {
  const store = useStoreApi()
  useLayoutEffect(() => {
    store
      .getState()
      .setNodes([
        createNode({ id: 'node-1', data: { title: 'Answer', type: BlockEnum.Answer } }),
        createNode({ id: 'start-node', data: { title: 'Start', type: BlockEnum.Start } }),
      ])
  }, [store])
  return children
}
const render = (ui: React.ReactElement) =>
  renderComponent(ui, {
    wrapper: ({ children }) => (
      <ReactFlowProvider>
        <Graph>{children}</Graph>
      </ReactFlowProvider>
    ),
  })

const createOperation = (
  overrides: Partial<AssignerNodeOperation> = {},
): AssignerNodeOperation => ({
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
  it('renders the empty-state hint when no assignable variable is configured', () => {
    render(
      <Node
        id="assigner-node"
        data={createData({
          items: [createOperation({ variable_selector: [] })],
        })}
      />,
    )

    expect(screen.getByText('workflowLogic.nodes.assigner.varNotSet')).toBeInTheDocument()
  })

  it('renders both version 2 and legacy previews with resolved node labels', () => {
    const { container, rerender } = render(<Node id="assigner-node" data={createData()} />)

    expect(screen.getByText('Answer')).toBeInTheDocument()
    expect(screen.getByText('count')).toBeInTheDocument()
    expect(
      screen.getByText('workflowLogic.nodes.assigner.operations.over-write'),
    ).toBeInTheDocument()

    // Legacy persisted graph payload predates the current AssignerNodeType.
    rerender(
      <Node
        id="assigner-node"
        data={
          {
            title: 'Legacy Assigner',
            desc: '',
            type: BlockEnum.VariableAssigner,
            assigned_variable_selector: ['sys', 'query'],
            write_mode: WriteMode.append,
          } as unknown as AssignerNodeType
        }
      />,
    )

    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText('workflowLogic.nodes.assigner.operations.append')).toBeInTheDocument()

    rerender(
      <Node
        id="assigner-node"
        data={
          {
            title: 'Legacy Assigner',
            desc: '',
            type: BlockEnum.VariableAssigner,
            assigned_variable_selector: [],
            write_mode: WriteMode.append,
          } as unknown as AssignerNodeType
        }
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

    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getAllByText('workflowLogic.nodes.assigner.operations.append')).toHaveLength(1)
    expect(
      screen.queryByText('workflowLogic.nodes.assigner.operations.over-write'),
    ).not.toBeInTheDocument()
  })
})
