import type { NodeProps } from 'reactflow'
import { useState } from 'react'
import ReactFlow, { ReactFlowProvider, useStoreApi } from 'reactflow'
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

const nodes = [{ id: 'node', type: 'test', position: { x: 100, y: 100 }, data: { title: 'Code' } }]
function TestNode({ data }: NodeProps) {
  return (
    <div style={{ width: 200, height: 100 }}>
      <span>{data.title}</span>
      <textarea className="nodrag" aria-label="Node editor" />
    </div>
  )
}
const nodeTypes = { test: TestNode }

function Canvas() {
  const store = useStoreApi()
  const onKeyDownCapture = useNodeKeyboardInteractions((id, cancel) => {
    const { getNodes, setNodes } = store.getState()
    setNodes(getNodes().map((node) => ({ ...node, selected: node.id === id && !cancel })))
  })
  return (
    <div id="workflow-container" style={{ width: 800, height: 600 }}>
      <ReactFlow
        nodes={nodes}
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

it('focuses a node with Tab, selects it, and moves it at canvas scale without scrolling or consuming editor keys', async () => {
  // Browser-owned: native tab order, focus visibility, and transformed canvas geometry.
  await page.viewport(1000, 800)
  const screen = await render(<Fixture />)
  await screen.getByRole('button', { name: 'Before canvas' }).click()
  await userEvent.tab()
  const node = screen.getByRole('button', { name: 'Code' })
  await expect.element(node).toHaveFocus()
  expect(getComputedStyle(node.element()).outlineStyle).toBe('solid')
  await userEvent.keyboard('{Enter}')
  const initial = node.element().getBoundingClientRect()
  await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
  await expect.poll(() => node.element().getBoundingClientRect().x).toBe(initial.x + 2.5)
  expect(node.element().getBoundingClientRect().y).toBe(initial.y + 10)
  await expect.element(node).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('textbox', { name: 'Node editor' })).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  expect(node.element().getBoundingClientRect().x).toBe(initial.x + 2.5)
  await userEvent.tab({ shift: true })
  await userEvent.keyboard('{Escape}{ArrowRight}')
  expect(node.element().getBoundingClientRect().x).toBe(initial.x + 2.5)
})
