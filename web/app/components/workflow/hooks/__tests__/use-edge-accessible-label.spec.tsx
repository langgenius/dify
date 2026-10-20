import type { Edge, Node } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { createReactI18nextMock } from '@/test/i18n-mock'
import { BlockEnum } from '../../types'
import { useEdgeAccessibleLabel } from '../use-edge-accessible-label'

vi.mock('react-i18next', () =>
  createReactI18nextMock({
    'workflow.common.edgeLabel': 'Connection from {{source}} to {{target}}',
    'workflow.common.onFailure': 'On failure',
    'workflow.nodes.questionClassifiers.class': 'Class',
    'workflow.nodes.humanInput.timeout.title': 'Timeout',
  }),
)

const makeNode = (id: string, title: string, data: Partial<Node['data']> = {}): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { title, desc: '', type: BlockEnum.LLM, ...data },
})

// Exercise the hook's DOM integration with the wrapper owned by React Flow 11.
const EdgeLabel = ({ sourceHandleId }: { sourceHandleId?: string }) => {
  const ref = useEdgeAccessibleLabel('source', 'target', sourceHandleId)
  return (
    <svg>
      <g className="react-flow__edge" role="button" aria-label="Edge from source to target">
        <g ref={ref} />
      </g>
    </svg>
  )
}

const EdgeLabelHarness = ({
  sourceNode = makeNode('source', 'Research'),
  sourceHandleId,
  onReadEdges,
}: {
  sourceNode?: Node
  sourceHandleId?: string
  onReadEdges?: (edges: Edge[]) => void
}) => {
  const store = useStoreApi()
  const { setNodes, setEdges } = store.getState()
  const updateNodes = (update: (nodes: Node[]) => Node[]) =>
    setNodes(update(Array.from(store.getState().nodeInternals.values()) as Node[]))
  useLayoutEffect(() => {
    setNodes([sourceNode, makeNode('target', 'Answer')])
    setEdges([
      { id: 'connection', source: 'source', target: 'target', sourceHandle: sourceHandleId },
    ])
  }, [setEdges, setNodes, sourceHandleId, sourceNode])
  return (
    <>
      <EdgeLabel sourceHandleId={sourceHandleId} />
      <button
        type="button"
        onClick={() =>
          updateNodes((nodes) =>
            nodes.map((node) =>
              node.id === 'source'
                ? { ...node, data: { ...node.data, title: 'Retrieve documents' } }
                : node,
            ),
          )
        }
      >
        Rename source
      </button>
      <button
        type="button"
        onClick={() =>
          updateNodes((nodes) =>
            nodes.map((node) =>
              node.id === 'target'
                ? { ...node, data: { ...node.data, title: 'Final response' } }
                : node,
            ),
          )
        }
      >
        Rename target
      </button>
      <button
        type="button"
        onClick={() => {
          onReadEdges?.(store.getState().edges)
        }}
      >
        Verify graph data
      </button>
    </>
  )
}

const renderEdge = (props: Parameters<typeof EdgeLabelHarness>[0] = {}) =>
  render(
    <ReactFlowProvider>
      <EdgeLabelHarness {...props} />
    </ReactFlowProvider>,
  )

describe('edge accessible labels', () => {
  it('uses current node titles after either endpoint is renamed without storing presentation metadata', async () => {
    const user = userEvent.setup()
    const onReadEdges = vi.fn()
    renderEdge({ onReadEdges })
    expect(
      screen.getByRole('button', { name: 'Connection from Research to Answer' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Rename source' }))
    expect(
      screen.getByRole('button', { name: 'Connection from Retrieve documents to Answer' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rename target' }))
    expect(
      screen.getByRole('button', { name: 'Connection from Retrieve documents to Final response' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Verify graph data' }))
    expect(onReadEdges).toHaveBeenCalledWith([
      { id: 'connection', source: 'source', target: 'target', sourceHandle: undefined },
    ])
  })

  it.each([
    [
      BlockEnum.IfElse,
      'false',
      [
        { id: 'true', name: 'IF' },
        { id: 'false', name: 'ELSE' },
      ],
      'ELSE',
    ],
    [
      BlockEnum.QuestionClassifier,
      'support',
      [
        { id: 'sales', name: 'Sales' },
        { id: 'support', name: 'Support' },
      ],
      'Class 2: Support',
    ],
    [BlockEnum.LLM, 'fail-branch', undefined, 'On failure'],
    [BlockEnum.HumanInput, '__timeout', undefined, 'Timeout'],
  ])(
    'identifies the %s output branch by its meaning',
    (type, sourceHandleId, branches, branchLabel) => {
      renderEdge({
        sourceNode: makeNode('source', 'Decision', { type, _targetBranches: branches }),
        sourceHandleId,
      })
      expect(
        screen.getByRole('button', { name: `Connection from Decision (${branchLabel}) to Answer` }),
      ).toBeInTheDocument()
    },
  )
})
