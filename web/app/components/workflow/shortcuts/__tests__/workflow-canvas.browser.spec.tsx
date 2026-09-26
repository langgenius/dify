import type { ContextMenuActions } from '@langgenius/dify-ui/context-menu'
import type { Edge, Node, NodeProps } from 'reactflow'
import type { StoreApi } from 'zustand'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, ReactFlowProvider, useStore as useReactFlowStore } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createStore, useStore } from 'zustand'
import { WorkflowContext } from '../../context'
import { EdgeContextmenu } from '../../edge-contextmenu'
import { useNodeKeyboardInteractions } from '../../hooks/use-node-keyboard-interactions'
import { NodeActionsDropdown } from '../../node-actions-menu'
import { NodeActionsContextMenuContent } from '../../node-actions-menu/context-menu-content'
import VarReferenceVars from '../../nodes/_base/components/variable/var-reference-vars'
import { NoteEditor, NoteEditorContextProvider } from '../../note-node/note-editor'
import NoteOperator from '../../note-node/note-editor/toolbar/operator'
import { SelectionContextmenu } from '../../selection-contextmenu'
import { createWorkflowStore } from '../../store/workflow'
import { BlockEnum, VarType } from '../../types'
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
  useEdgesInteractions: () => ({
    handleEdgeDelete: actions.deleteEdge,
    handleEdgeDeleteById: actions.deleteEdge,
  }),
}))
vi.mock('../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: actions.save }),
}))
vi.mock('../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false, getNodesReadOnly: () => false }),
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

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({ workspacePermissionKeys: [] }))
})
vi.mock('@/app/components/snippets/hooks/use-create-snippet-from-selection', () => ({
  useCreateSnippetFromSelection: () => ({
    createSnippetDialog: null,
    handleOpenCreateSnippet: () => {},
    isCreateSnippetDialogOpen: false,
  }),
}))
vi.mock('../../hooks/use-workflow-history', () => ({
  WorkflowHistoryEvent: { NodeDragStop: 'NodeDragStop' },
  useWorkflowHistory: () => ({ saveStateToHistory: () => {} }),
}))

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
type GraphState = { nodes: Node[]; edges: Edge[] }
const createGraph = () => createStore<GraphState>(() => ({ nodes: initialNodes, edges: [] }))

function Canvas({
  graph,
  contextMenuType,
}: {
  graph?: StoreApi<GraphState>
  contextMenuType?: 'node' | 'edge' | 'selection'
}) {
  const contextMenuActionsRef = useRef<ContextMenuActions>(null)
  const [defaultGraph] = useState(createGraph)
  const nodes = useStore(graph ?? defaultGraph, (state) => state.nodes)
  const edges = useStore(graph ?? defaultGraph, (state) => state.edges)
  const [store] = useState(() => createWorkflowStore({}))
  return (
    <WorkflowContext value={store}>
      <ReactFlowProvider>
        <ContextMenu actionsRef={contextMenuActionsRef}>
          <ContextMenuTrigger render={<div style={{ width: 800, height: 500 }} />}>
            <WorkflowCanvas
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              selectionOnDrag={contextMenuType === 'selection'}
              panOnDrag={contextMenuType !== 'selection'}
              onSelectionContextMenu={() =>
                store.setState({ contextMenuTarget: { type: 'selection' } })
              }
              onEdgeContextMenu={(_, edge) =>
                store.setState({ contextMenuTarget: { type: 'edge', edgeId: edge.id } })
              }
            >
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
          {contextMenuType === 'node' ? (
            nodes.length > 0 && (
              <NodeActionsContextMenuContent
                id="node"
                data={{ type: BlockEnum.Code, title: 'Workflow node', desc: '' }}
                onClose={() => contextMenuActionsRef.current?.close()}
                showHelpLink={false}
              />
            )
          ) : contextMenuType === 'selection' ? (
            <SelectionContextmenu onClose={() => contextMenuActionsRef.current?.close()} />
          ) : contextMenuType === 'edge' ? (
            <EdgeContextmenu onClose={() => contextMenuActionsRef.current?.close()} />
          ) : (
            <ContextMenuContent>
              <ContextMenuItem>Canvas menu action</ContextMenuItem>
            </ContextMenuContent>
          )}
        </ContextMenu>
        <input aria-label="Outside canvas input" />
      </ReactFlowProvider>
    </WorkflowContext>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

it('admits and releases keyboard focus while keeping character shortcuts inside the canvas', async () => {
  // Native Tab navigation and shifted printable keys establish the focused-component boundary.
  await page.viewport(1000, 700)
  const screen = await render(
    <>
      <button>Before canvas</button>
      <Canvas />
    </>,
  )
  const before = screen.getByRole('button', { name: 'Before canvas' })
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByRole('button', { name: 'Workflow node' })
  const outside = screen.getByRole('textbox', { name: 'Outside canvas input' })

  await userEvent.keyboard('{Tab}')
  await expect.element(before).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard('vhc')
  expect(actions.pointer).toHaveBeenCalledOnce()
  expect(actions.hand).toHaveBeenCalledOnce()
  expect(actions.comment).toHaveBeenCalledOnce()

  const initialWidth = node.element().getBoundingClientRect().width
  expect(initialWidth).toBeGreaterThan(0)
  await userEvent.keyboard('{Shift>}[Digit5]{/Shift}')
  await expect
    .poll(() => node.element().getBoundingClientRect().width)
    .toBeCloseTo(initialWidth / 2)
  await userEvent.keyboard('{Shift>}[Digit1]{/Shift}')
  await expect.poll(() => node.element().getBoundingClientRect().width).toBeCloseTo(initialWidth)

  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(before).toHaveFocus()
  await userEvent.keyboard('vhc{Shift>}[Digit5]{/Shift}')
  expect(node.element().getBoundingClientRect().width).toBeCloseTo(initialWidth)

  await userEvent.keyboard('{Tab}')
  await expect.element(canvas).toHaveFocus()
  for (let steps = 0; steps < 10 && document.activeElement !== outside.element(); steps++)
    await userEvent.keyboard('{Tab}')
  await expect.element(outside).toHaveFocus()
  await userEvent.keyboard('vhc')
  await expect.element(outside).toHaveValue('vhc')

  await screen.getByRole('textbox', { name: 'workflow.nodes.note.editor.label' }).click()
  await userEvent.keyboard('vhc')
  await screen.getByRole('button', { name: 'Popup action' }).click()
  await userEvent.keyboard('vhc{Shift>}[Digit5]{/Shift}')
  expect(node.element().getBoundingClientRect().width).toBeCloseTo(initialWidth)
  expect(actions.pointer).toHaveBeenCalledOnce()
  expect(actions.hand).toHaveBeenCalledOnce()
  expect(actions.comment).toHaveBeenCalledOnce()
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

it('returns to canvas undo after a node context-menu action removes the focused node', async () => {
  await page.viewport(1000, 700)
  const graph = createGraph()
  actions.deleteNodes.mockImplementation(() => graph.setState({ nodes: [] }))
  actions.undo.mockImplementation(() => graph.setState({ nodes: initialNodes }))
  const screen = await render(<Canvas graph={graph} contextMenuType="node" />)
  const node = screen.getByRole('button', { name: 'Workflow node' })
  await node.click({ button: 'right' })
  await screen.getByRole('menuitem', { name: /common.operation.delete/ }).click()
  await expect.element(node).not.toBeInTheDocument()
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  await expect.element(canvas).toHaveFocus()
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  await expect.element(node).toBeInTheDocument()
  expect(actions.undo).toHaveBeenCalledTimes(1)
})

it('returns to canvas undo after an edge context-menu action removes the focused edge', async () => {
  await page.viewport(1000, 700)
  const graph = createGraph()
  const nodes = [
    ...initialNodes,
    { id: 'other', position: { x: 500, y: 300 }, data: { label: 'Other node' } },
  ]
  const edges = [{ id: 'edge', source: 'node', target: 'other' }]
  graph.setState({ nodes, edges })
  actions.deleteEdge.mockImplementation(() => graph.setState({ edges: [] }))
  actions.undo.mockImplementation(() => graph.setState({ edges }))
  const screen = await render(<Canvas graph={graph} contextMenuType="edge" />)
  const edge = screen.getByTestId('rf__edge-edge')
  const outsideInput = screen.getByLabelText('Outside canvas input')
  await outsideInput.click()
  await edge.click({ button: 'right' })
  await screen.getByRole('menuitem', { name: /common.operation.delete/ }).click()
  await expect.element(edge).not.toBeInTheDocument()
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  await expect.element(canvas).toHaveFocus()
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  await expect.element(edge).toBeInTheDocument()
  expect(actions.undo).toHaveBeenCalledTimes(1)
  await edge.click({ button: 'right' })
  await userEvent.keyboard('{Escape}')
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  expect(actions.undo).toHaveBeenCalledTimes(2)
})

it('returns to canvas undo after a selection context-menu action removes the focused selection', async () => {
  await page.viewport(1000, 700)
  const graph = createGraph()
  const nodes = [
    ...initialNodes,
    { id: 'other', position: { x: 500, y: 300 }, data: { label: 'Other node' } },
  ]
  graph.setState({ nodes })
  actions.deleteNodes.mockImplementation(() => graph.setState({ nodes: [] }))
  actions.undo.mockImplementation(() => graph.setState({ nodes }))
  const screen = await render(<Canvas graph={graph} contextMenuType="selection" />)
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 300, y: 120 },
    targetPosition: { x: 700, y: 380 },
    steps: 5,
  })
  await expect
    .poll(() => canvas.element().querySelector('.react-flow__nodesselection-rect'))
    .not.toBeNull()
  await canvas.click({ button: 'right', position: { x: 450, y: 220 } })
  await screen.getByRole('menuitem', { name: /common.operation.delete/ }).click()
  await expect
    .element(screen.getByRole('button', { name: 'Workflow node' }))
    .not.toBeInTheDocument()
  await expect.element(canvas).toHaveFocus()
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`)
  await expect.element(screen.getByRole('button', { name: 'Workflow node' })).toBeInTheDocument()
  expect(actions.undo).toHaveBeenCalledTimes(1)
})

it('keeps focus on an outside input when it dismisses a node dropdown', async () => {
  await page.viewport(1000, 700)
  const graph = createGraph()
  graph.setState({ nodes: initialNodes.map((node) => ({ ...node, type: 'menu' })) })
  const screen = await render(<Canvas graph={graph} />)
  await screen.getByRole('button', { name: 'common.operation.more' }).click()
  await expect.element(screen.getByRole('menuitem', { name: /workflow.common.copy/ })).toBeVisible()
  const outsideInput = screen.getByRole('textbox', { name: 'Outside canvas input' })
  await outsideInput.click()
  await expect
    .element(screen.getByRole('menuitem', { name: /workflow.common.copy/ }))
    .not.toBeInTheDocument()
  await expect.element(outsideInput).toHaveFocus()
})

function VariableConnectionNode({ id }: NodeProps) {
  return (
    <div style={{ width: 150, height: 80 }}>
      {id}
      <Handle type="source" position={Position.Right} data-testid={`source-${id}`} />
      <Handle type="target" position={Position.Left} data-testid={`target-${id}`} />
    </div>
  )
}
const variableConnectionNodeTypes = { connection: VariableConnectionNode }
const variableConnectionNodes: Node[] = [
  {
    id: 'source',
    type: 'connection',
    position: { x: 100, y: 150 },
    data: { type: BlockEnum.Code, title: 'Source' },
  },
  {
    id: 'assigner',
    type: 'connection',
    position: { x: 500, y: 150 },
    data: { type: BlockEnum.VariableAssigner, title: 'Assigner' },
  },
]

function VariableConnectionCanvas({ onSelect }: { onSelect: (value: string[]) => void }) {
  const [showPicker, setShowPicker] = useState(false)
  const canvas = useReactFlowStore((state) => state.domNode)
  const handleNodeKeyDown = useNodeKeyboardInteractions(() => {})

  return (
    <div style={{ width: 800, height: 500 }}>
      <WorkflowCanvas
        nodes={variableConnectionNodes}
        edges={[]}
        nodeTypes={variableConnectionNodeTypes}
        onKeyDownCapture={handleNodeKeyDown}
        onConnectEnd={() => setShowPicker(true)}
        deleteKeyCode={null}
      >
        {showPicker && (
          <VarReferenceVars
            hideSearch
            keyboardTarget={canvas}
            vars={[
              {
                nodeId: 'source',
                title: 'Source',
                vars: [
                  { variable: 'first', type: VarType.string },
                  { variable: 'second', type: VarType.string },
                ],
              },
            ]}
            onChange={onSelect}
          />
        )}
      </WorkflowCanvas>
    </div>
  )
}

it('selects a connection variable before node movement handles the focused node keys', async () => {
  // Real handle dragging preserves node focus; React capture must not move that node before the picker sees its keys.
  await page.viewport(1000, 700)
  const store = createWorkflowStore({})
  const onSelect = vi.fn()
  const screen = await render(
    <WorkflowContext value={store}>
      <ReactFlowProvider>
        <VariableConnectionCanvas onSelect={onSelect} />
        <textarea aria-label="Outside variable picker" />
      </ReactFlowProvider>
    </WorkflowContext>,
  )

  const source = screen.getByTestId('rf__node-source')
  await source.click()
  await userEvent.dragAndDrop(
    screen.getByTestId('source-source'),
    screen.getByTestId('target-assigner'),
    { steps: 5 },
  )
  await expect.element(screen.getByText('first', { exact: true })).toBeVisible()
  await expect.element(source).toHaveFocus()
  const sourcePosition = source.element().getBoundingClientRect()

  await userEvent.keyboard('{ArrowDown}{Enter}')

  expect(onSelect).toHaveBeenCalledExactlyOnceWith(
    ['source', 'second'],
    expect.objectContaining({ variable: 'second' }),
  )
  expect(source.element().getBoundingClientRect().x).toBe(sourcePosition.x)
  expect(source.element().getBoundingClientRect().y).toBe(sourcePosition.y)

  const outside = screen.getByRole('textbox', { name: 'Outside variable picker' })
  await outside.click()
  await userEvent.keyboard('top{Enter}bottom{Home}{ArrowUp}x')
  await expect.element(outside).toHaveValue('xtop\nbottom')
  expect(onSelect).toHaveBeenCalledTimes(1)
})
