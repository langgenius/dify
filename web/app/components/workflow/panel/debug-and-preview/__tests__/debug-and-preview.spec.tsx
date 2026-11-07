import type { Ref } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle } from 'react'
import { useEdges, useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import DebugAndPreview from '../index'

const restartChat = vi.fn()
// Conversation streaming is tested by ChatWrapper; this panel owns graph cleanup and visibility.
vi.mock('../chat-wrapper', () => ({
  default: function Chat({
    ref,
    showInputsFieldsPanel,
    onHide,
  }: {
    ref: Ref<{ handleRestart: () => void }>
    showInputsFieldsPanel: boolean
    onHide: () => void
  }) {
    useImperativeHandle(ref, () => ({ handleRestart: restartChat }))
    return showInputsFieldsPanel ? (
      <button type="button" onClick={onHide}>
        Hide inputs
      </button>
    ) : null
  },
}))

function GraphState() {
  const nodes = useNodes()
  const edges = useEdges()
  return <output aria-label="Graph state">{JSON.stringify({ nodes, edges })}</output>
}
const readGraph = () => JSON.parse(screen.getByLabelText('Graph state').textContent!)
function setup() {
  return renderWorkflowFlowComponent(
    <>
      <DebugAndPreview />
      <GraphState />
    </>,
    {
      initialStoreState: {
        previewPanelWidth: 480,
        workflowCanvasWidth: 1000,
        showDebugAndPreviewPanel: true,
      },
      nodes: [
        createNode({
          id: 'start',
          data: {
            type: BlockEnum.Start,
            variables: [{ label: 'Topic', variable: 'topic' }],
            _runningStatus: NodeRunningStatus.Running,
            _waitingRun: true,
          },
        }),
        createNode({ id: 'end' }),
      ],
      edges: [
        createEdge({
          source: 'start',
          target: 'end',
          data: {
            _sourceRunningStatus: NodeRunningStatus.Running,
            _targetRunningStatus: NodeRunningStatus.Running,
            _waitingRun: true,
          },
        }),
      ],
    },
  )
}
const widthKey = 'debug-and-preview-panel-width'
let previousWidth: string | null
beforeEach(() => {
  previousWidth = localStorage.getItem(widthKey)
})
afterEach(() => {
  if (previousWidth === null) localStorage.removeItem(widthKey)
  else localStorage.setItem(widthKey, previousWidth)
})

it('resizes from the left edge with the keyboard and persists bounded width', async () => {
  const user = userEvent.setup()
  setup()
  const handle = screen.getByRole('separator', { name: 'workflow.common.debugAndPreview' })
  handle.focus()
  await user.keyboard('{ArrowLeft}')
  expect(handle).toHaveAttribute('aria-valuenow', '488')
  await waitFor(() => expect(localStorage.getItem(widthKey)).toBe('488'))
  await user.keyboard('{End}{ArrowLeft}')
  expect(handle).toHaveAttribute('aria-valuenow', '600')
  await user.keyboard('{Home}')
  expect(handle).toHaveAttribute('aria-valuenow', '400')
})

it.each(['restart', 'close'])(
  'clears actual node and edge execution markers on %s',
  async (action) => {
    const user = userEvent.setup()
    const { store } = setup()
    await waitFor(() => expect(readGraph().nodes).toHaveLength(2))
    await user.click(
      screen.getByRole('button', {
        name: action === 'restart' ? 'common.operation.refresh' : 'common.operation.close',
      }),
    )
    const graph = readGraph()
    expect(graph.nodes[0].data).toMatchObject({ _waitingRun: false })
    expect(graph.nodes[0].data._runningStatus).toBeUndefined()
    expect(graph.edges[0].data).toMatchObject({ _waitingRun: false })
    expect(graph.edges[0].data._sourceRunningStatus).toBeUndefined()
    expect(graph.edges[0].data._targetRunningStatus).toBeUndefined()
    if (action === 'restart') {
      expect(restartChat).toHaveBeenCalledOnce()
      expect(store.getState().showDebugAndPreviewPanel).toBe(true)
    } else {
      expect(store.getState().showDebugAndPreviewPanel).toBe(false)
      expect(store.getState().workflowRunningData).toBeUndefined()
      expect(restartChat).not.toHaveBeenCalled()
    }
  },
)

it('keeps the input toggle synchronized with closing inputs from the chat', async () => {
  const user = userEvent.setup()
  setup()
  const toggle = await screen.findByRole('button', { name: 'workflow.panel.userInputField' })
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: 'Hide inputs' })).not.toBeInTheDocument()
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Hide inputs' }))
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
})
