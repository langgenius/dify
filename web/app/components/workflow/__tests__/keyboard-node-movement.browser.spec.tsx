import type { NodeProps } from 'reactflow'
import { useState } from 'react'
import ReactFlow, { Handle, Position, ReactFlowProvider, useStoreApi } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkflowContext } from '../context'
import { useNodeKeyboardInteractions } from '../hooks/use-node-keyboard-interactions'
import { createWorkflowStore } from '../store/workflow'
import 'reactflow/dist/style.css'
import '../style.css'

vi.mock('../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ getNodesReadOnly: () => false }),
}))
vi.mock('../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: vi.fn() }),
}))
vi.mock('../hooks/use-workflow-history', () => ({
  WorkflowHistoryEvent: { NodeDragStop: 'NodeDragStop' },
  useWorkflowHistory: () => ({ saveStateToHistory: vi.fn() }),
}))
vi.mock('../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    canApplyLocalGraphMutation: () => true,
  },
}))

const nodes = [
  {
    id: 'node',
    type: 'test',
    ariaLabel: 'Code',
    position: { x: 100, y: 100 },
    data: { title: 'Code' },
  },
  {
    id: 'output',
    type: 'test',
    ariaLabel: 'Output',
    position: { x: 500, y: 200 },
    data: { title: 'Output' },
  },
]
const edges = [{ id: 'connection', source: 'node', target: 'output', type: 'straight' }]
function TestNode({ id, data }: NodeProps) {
  const store = useStoreApi()
  return (
    <div style={{ width: 200, height: 100 }}>
      <Handle type="target" position={Position.Left} />
      <button
        type="button"
        aria-label={`Select ${data.title}`}
        data-node-keyboard-target
        onClick={() => {
          const { getNodes, setNodes } = store.getState()
          setNodes(getNodes().map((node) => ({ ...node, selected: node.id === id })))
        }}
      >
        {data.title}
      </button>
      <textarea className="nodrag" aria-label={`${data.title} editor`} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
const nodeTypes = { test: TestNode }

function Canvas() {
  const [initialNodes] = useState(() =>
    nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data },
    })),
  )
  const store = useStoreApi()
  const onKeyDownCapture = useNodeKeyboardInteractions((id, cancel) => {
    const { getNodes, setNodes } = store.getState()
    setNodes(getNodes().map((node) => ({ ...node, selected: node.id === id && !cancel })))
  })
  return (
    <div id="workflow-container" style={{ width: 800, height: 600 }}>
      <ReactFlow
        nodes={initialNodes}
        edges={edges}
        edgesFocusable={false}
        nodeTypes={nodeTypes}
        onKeyDownCapture={onKeyDownCapture}
        defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
      />
    </div>
  )
}

function Fixture() {
  const [store] = useState(() => createWorkflowStore({}))
  return (
    <WorkflowContext value={store}>
      <ReactFlowProvider>
        <button type="button">Before canvas</button>
        <Canvas />
      </ReactFlowProvider>
    </WorkflowContext>
  )
}

it('moves a Tab-focused node without selecting it first, at canvas scale without consuming editor keys', async () => {
  // Browser-owned: native tab order, focus visibility, and transformed canvas geometry.
  await page.viewport(1000, 800)
  const screen = await render(<Fixture />)
  await screen.getByRole('button', { name: 'Before canvas' }).click()
  await userEvent.tab()
  const node = screen.getByRole('button', { name: 'Code', exact: true })
  await expect.element(node).toHaveFocus()
  expect(getComputedStyle(node.element()).outlineStyle).toBe('solid')
  const edge = screen.getByRole('img', { name: 'Edge from node to output' })
  await expect.element(edge).toBeVisible()
  const initial = node.element().getBoundingClientRect()
  const initialEdge = edge.element().getBoundingClientRect()
  await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
  await expect.poll(() => node.element().getBoundingClientRect().x).toBe(initial.x + 2.5)
  expect(node.element().getBoundingClientRect().y).toBe(initial.y + 10)
  expect(edge.element().getBoundingClientRect().x).toBe(initialEdge.x + 2.5)
  expect(edge.element().getBoundingClientRect().y).toBe(initialEdge.y + 10)
  await expect.element(node).toHaveFocus()
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(screen.getByRole('textbox', { name: 'Code editor' })).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  expect(node.element().getBoundingClientRect().x).toBe(initial.x + 2.5)
  await userEvent.tab({ shift: true })
  await userEvent.tab({ shift: true })
  await userEvent.keyboard('{Escape}{ArrowRight}')
  await expect.poll(() => node.element().getBoundingClientRect().x).toBe(initial.x + 5)
})

it('keeps a connected edge attached when a click-selected node moves with the keyboard', async () => {
  // Browser-owned: React Flow measures real handles and projects their positions into the edge SVG.
  await page.viewport(1000, 800)
  const screen = await render(<Fixture />)
  const node = screen.getByRole('button', { name: 'Code', exact: true })
  const edge = screen.getByRole('img', { name: 'Edge from node to output' })
  await expect.element(edge).toBeVisible()
  const header = screen.getByRole('button', { name: 'Select Code' })
  await header.click()
  await expect.element(header).toHaveFocus()
  const initialNode = node.element().getBoundingClientRect()
  const initialEdge = edge.element().getBoundingClientRect()

  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => node.element().getBoundingClientRect().x).toBe(initialNode.x + 2.5)
  expect(edge.element().getBoundingClientRect().x).toBe(initialEdge.x + 2.5)
  expect(edge.element().getBoundingClientRect().right).toBe(initialEdge.right)

  await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
  await expect.poll(() => node.element().getBoundingClientRect().x).toBe(initialNode.x - 7.5)
  expect(edge.element().getBoundingClientRect().x).toBe(initialEdge.x - 7.5)
  expect(edge.element().getBoundingClientRect().right).toBe(initialEdge.right)
  await expect.element(header).toHaveFocus()
})
