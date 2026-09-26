import type { Node, NodeProps } from 'reactflow'
import type { StoreApi } from 'zustand'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createStore, useStore } from 'zustand'
import { WorkflowContext } from '../../context'
import { NodeActionsDropdown } from '../../node-actions-menu'
import { NoteEditor, NoteEditorContextProvider } from '../../note-node/note-editor'
import NoteOperator from '../../note-node/note-editor/toolbar/operator'
import { createWorkflowStore } from '../../store/workflow'
import { BlockEnum } from '../../types'
import { WorkflowCanvas } from '../workflow-canvas'
import 'reactflow/dist/style.css'

const actions = vi.hoisted(() => ({
  copy: vi.fn(),
  paste: vi.fn(),
  duplicate: vi.fn(),
  deleteNodes: vi.fn(),
  deleteEdge: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  save: vi.fn(),
  organize: vi.fn(),
  hand: vi.fn(),
  pointer: vi.fn(),
  comment: vi.fn(),
  dim: vi.fn(),
  undim: vi.fn(),
  zoomTo: vi.fn(),
  fitView: vi.fn(),
  getZoom: vi.fn(() => 1),
  getNodes: vi.fn<() => { data: { _isBundled?: boolean } }[]>(() => []),
}))

vi.mock('../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodesCopy: actions.copy,
    handleNodesPaste: actions.paste,
    handleNodesDuplicate: actions.duplicate,
    handleNodesDelete: actions.deleteNodes,
    handleNodeDelete: actions.deleteNodes,
    handleHistoryBack: actions.undo,
    handleHistoryForward: actions.redo,
    dimOtherNodes: actions.dim,
    undimAllNodes: actions.undim,
  }),
}))
vi.mock('../../hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => ({ handleEdgeDelete: actions.deleteEdge }),
}))
vi.mock('../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: actions.save }),
}))
vi.mock('../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))
vi.mock('../../hooks/use-workflow-organize', () => ({
  useWorkflowOrganize: () => ({ handleLayout: actions.organize }),
}))
vi.mock('../../hooks/use-workflow-panel-interactions', () => ({
  useWorkflowMoveMode: () => ({
    handleModeHand: actions.hand,
    handleModePointer: actions.pointer,
    handleModeComment: actions.comment,
    canUseCommentMode: true,
  }),
}))

vi.mock('../../hooks-store', () => ({
  useHooksStore: (selector: (state: { accessControl: { canRun: boolean } }) => unknown) =>
    selector({ accessControl: { canRun: false } }),
}))
vi.mock('../../hooks/use-nodes-meta-data', () => ({
  useNodeMetaData: () => ({
    isTypeFixed: true,
    isSingleton: false,
    isUndeletable: false,
    description: 'Test node',
    author: 'Dify',
  }),
}))
vi.mock('@/service/use-tools', () => ({ useAllWorkflowTools: () => ({ data: [] }) }))
vi.mock('../../node-actions-menu/change-block-popup', () => ({ ChangeBlockPopup: () => null }))

function NodeWithMenu({ id }: NodeProps) {
  return (
    <div className="nodrag nopan">
      Workflow node
      <NodeActionsDropdown
        id={id}
        data={{ type: BlockEnum.Code, title: 'Workflow node', desc: '' }}
        showHelpLink={false}
      />
    </div>
  )
}
function NoteWithMenu() {
  return (
    <div className="nodrag nopan">
      Note node
      <NoteOperator
        onCopy={actions.copy}
        onDuplicate={actions.duplicate}
        onDelete={actions.deleteNodes}
        showAuthor={false}
        onShowAuthorChange={() => {}}
      />
    </div>
  )
}
const nodeTypes = { menu: NodeWithMenu, note: NoteWithMenu }

const initialNodes: Node[] = [
  { id: 'node', position: { x: 350, y: 150 }, data: { label: 'Workflow node' } },
]
const createGraph = () => createStore<{ nodes: Node[] }>(() => ({ nodes: initialNodes }))

function Canvas({ graph }: { graph?: StoreApi<{ nodes: Node[] }> }) {
  const [defaultGraph] = useState(createGraph)
  const nodes = useStore(graph ?? defaultGraph, (state) => state.nodes)
  const [store] = useState(() => createWorkflowStore({}))
  return (
    <WorkflowContext value={store}>
      <ReactFlowProvider>
        <ContextMenu>
          <ContextMenuTrigger render={<div style={{ width: 800, height: 500 }} />}>
            <WorkflowCanvas nodes={nodes} edges={[]} nodeTypes={nodeTypes}>
              <textarea
                aria-label="Node prompt"
                style={{ position: 'absolute', zIndex: 5, top: 20, left: 20 }}
              />
              <div
                style={{
                  position: 'absolute',
                  zIndex: 5,
                  top: 80,
                  left: 20,
                  width: 240,
                  minHeight: 80,
                }}
              >
                <NoteEditorContextProvider>
                  <NoteEditor containerElement={null} />
                </NoteEditorContextProvider>
              </div>
              {createPortal(<button>Popup action</button>, document.body)}
            </WorkflowCanvas>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Canvas menu action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <input aria-label="Outside canvas input" />
      </ReactFlowProvider>
    </WorkflowContext>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

it('acquires canvas focus from pane and node clicks while preserving native editor undo', async () => {
  // Native focus, React Flow pointer handling, and textarea undo cannot be proved by synthetic key events.
  await page.viewport(1000, 700)
  const screen = await render(<Canvas />)
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await canvas.click({ position: { x: 650, y: 400 } })
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
  expect(actions.save).toHaveBeenCalledTimes(1)

  const node = screen.getByRole('button', { name: 'Workflow node' })
  await node.click()
  await expect.element(node).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  expect(actions.undo).toHaveBeenCalledTimes(1)

  const prompt = screen.getByRole('textbox', { name: 'Node prompt' })
  await prompt.click()
  await userEvent.keyboard('Draft text')
  await expect.element(prompt).toHaveValue('Draft text')
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  await expect.element(prompt).toHaveValue('')
  expect(actions.undo).toHaveBeenCalledTimes(1)

  await screen.getByRole('button', { name: 'Popup action' }).click()
  await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
  expect(actions.save).toHaveBeenCalledTimes(1)

  await canvas.click({ position: { x: 650, y: 400 } })
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
  expect(actions.save).toHaveBeenCalledTimes(2)
})

it('keeps canvas focus when delete, undo, or redo removes the focused node', async () => {
  await page.viewport(1000, 700)
  const graph = createGraph()
  actions.deleteNodes.mockImplementation(() => graph.setState({ nodes: [] }))
  actions.undo.mockImplementation(() => graph.setState({ nodes: initialNodes }))
  actions.redo.mockImplementation(() => graph.setState({ nodes: [] }))
  const screen = await render(<Canvas graph={graph} />)
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByRole('button', { name: 'Workflow node' })
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'

  await node.click()
  await userEvent.keyboard('{Delete}')
  await expect.element(node).not.toBeInTheDocument()
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  await expect.element(node).toBeInTheDocument()

  await node.click()
  await userEvent.keyboard(`{${mod}>}{Shift>}z{/Shift}{/${mod}}`)
  await expect.element(node).not.toBeInTheDocument()
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  await expect.element(node).toBeInTheDocument()

  actions.undo.mockImplementation(() => graph.setState({ nodes: [] }))
  actions.redo.mockImplementation(() => graph.setState({ nodes: initialNodes }))
  await node.click()
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  await expect.element(node).not.toBeInTheDocument()
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}{Shift>}z{/Shift}{/${mod}}`)
  await expect.element(node).toBeInTheDocument()
})

it('lets the production Note editor own text history and returns graph history on a pane click', async () => {
  await page.viewport(1000, 700)
  const screen = await render(<Canvas />)
  const note = screen.getByRole('textbox', { name: 'workflow.nodes.note.editor.label' })
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await note.click()
  await userEvent.keyboard('Note text')
  await expect.element(note).toHaveTextContent('Note text')
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  await expect.element(note).toBeEmptyDOMElement()
  expect(actions.undo).not.toHaveBeenCalled()
  await userEvent.keyboard(`{${mod}>}{Shift>}z{/Shift}{/${mod}}`)
  await expect.element(note).toHaveTextContent('Note text')
  expect(actions.redo).not.toHaveBeenCalled()

  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  await canvas.click({ position: { x: 650, y: 400 } })
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  expect(actions.undo).toHaveBeenCalledTimes(1)
})

it('returns focus to the canvas after a context menu opened from outside focus closes', async () => {
  await page.viewport(1000, 700)
  const screen = await render(<Canvas />)
  const outsideInput = screen.getByRole('textbox', { name: 'Outside canvas input' })
  await outsideInput.click()
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  await canvas.click({ button: 'right', position: { x: 650, y: 400 } })
  await expect.element(screen.getByRole('menuitem', { name: 'Canvas menu action' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Escape}')
  await expect.element(canvas).toHaveFocus()
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  expect(actions.undo).toHaveBeenCalledTimes(1)
})

it.each(['menu', 'note'])(
  'returns to canvas history after the %s menu deletes its own trigger',
  async (nodeType) => {
    await page.viewport(1000, 700)
    const graph = createGraph()
    const menuNodes = initialNodes.map((node) => ({ ...node, type: nodeType }))
    graph.setState({ nodes: menuNodes })
    actions.deleteNodes.mockImplementation(() => graph.setState({ nodes: [] }))
    actions.undo.mockImplementation(() => graph.setState({ nodes: menuNodes }))
    const screen = await render(<Canvas graph={graph} />)
    const more = screen.getByRole('button', { name: 'common.operation.more' })
    await more.click()
    await screen.getByRole('menuitem', { name: /common.operation.delete/ }).click()
    await expect.element(more).not.toBeInTheDocument()
    const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
    await expect.element(canvas).toHaveFocus()
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
    await expect.element(more).toBeInTheDocument()
    expect(actions.undo).toHaveBeenCalledTimes(1)
  },
)
