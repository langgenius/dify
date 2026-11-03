import type { ContextMenuActions } from '@langgenius/dify-ui/context-menu'
import type { NodeProps } from 'reactflow'
import type { Edge, Node } from '../../types'
import { ContextMenu, ContextMenuTrigger } from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, useStore as useReactFlowStore, useStoreApi } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { CanvasNodesCatalogProbe } from '../../__tests__/canvas-nodes-catalog-probe'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowBrowserComponent as render } from '../../__tests__/workflow-browser-test-env'
import { EdgeContextmenu } from '../../edge-contextmenu'
import { useEdgesInteractions } from '../../hooks/use-edges-interactions'
import { useNodeKeyboardInteractions } from '../../hooks/use-node-keyboard-interactions'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import { useSelectionInteractions } from '../../hooks/use-selection-interactions'
import { NodeActionsMenu } from '../../node-actions-menu'
import { NodeActionsContextMenuContent } from '../../node-actions-menu/context-menu-content'
import VarReferenceVars from '../../nodes/_base/components/variable/var-reference-vars'
import { NoteEditor, NoteEditorContextProvider } from '../../note-node/note-editor'
import NoteOperator from '../../note-node/note-editor/toolbar/operator'
import { SelectionContextmenu } from '../../selection-contextmenu'
import { BlockEnum, ControlMode, VarType } from '../../types'
import { WorkflowCanvas } from '../workflow-canvas'
import 'reactflow/dist/style.css'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const unexpectedFetch = vi.fn<typeof fetch>(() => new Promise(() => {}))
beforeEach(() => vi.stubGlobal('fetch', unexpectedFetch))
afterEach(() => {
  vi.unstubAllGlobals()
  expect(unexpectedFetch).not.toHaveBeenCalled()
})

function NodeWithMenu({ id, data }: NodeProps) {
  return (
    <div className="nodrag nopan">
      Workflow node
      <NodeActionsMenu id={id} data={data} showHelpLink={false} />
    </div>
  )
}
function NoteWithMenu({ id }: NodeProps) {
  const { handleNodesCopy, handleNodesDuplicate, handleNodeDelete } = useNodesInteractions()
  return (
    <div className="nodrag nopan">
      Note node
      <NoteOperator
        onCopy={() => handleNodesCopy(id)}
        onDuplicate={() => handleNodesDuplicate(id)}
        onDelete={() => handleNodeDelete(id)}
        showAuthor={false}
        onShowAuthorChange={() => {}}
      />
    </div>
  )
}
const nodeTypes = { menu: NodeWithMenu, note: NoteWithMenu }
const initialNodes = [
  createNode({
    id: 'node',
    type: 'default',
    ariaLabel: 'Workflow node',
    position: { x: 350, y: 150 },
    data: { label: 'Workflow node' },
  }),
  // Keep a nonempty snapshot for redo; the known empty-canvas redo bug is outside this batch.
  createNode({
    id: 'anchor',
    type: 'default',
    ariaLabel: 'Anchor node',
    position: { x: 730, y: 430 },
    data: { label: 'Anchor node' },
  }),
]
let flow: ReturnType<typeof useStoreApi>
const graphNodes = () => flow.getState().getNodes()
const graphEdges = () => flow.getState().edges
const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
const undo = () => userEvent.keyboard(`{${mod}>}z{/${mod}}`)
const redo = () => userEvent.keyboard(`{${mod}>}{Shift>}z{/Shift}{/${mod}}`)

// Advance the production history debounce explicitly, without relying on CI wall-clock speed.
async function recordHistory(action: () => Promise<unknown>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  try {
    await action()
    await vi.advanceTimersByTimeAsync(600)
  } finally {
    vi.useRealTimers()
  }
}

type CanvasProps = {
  nodes?: Node[]
  edges?: Edge[]
  contextMenuType?: 'node' | 'edge' | 'selection'
}
function Canvas({ nodes = initialNodes, edges = [], contextMenuType }: CanvasProps) {
  flow = useStoreApi()
  const { handleSelectionStart, handleSelectionChange, handleSelectionContextMenu } =
    useSelectionInteractions()
  const contextMenuActionsRef = useRef<ContextMenuActions>(null)
  const { handleNodeSelect } = useNodesInteractions()
  const { handleEdgeContextMenu } = useEdgesInteractions()
  const onKeyDownCapture = useNodeKeyboardInteractions(handleNodeSelect)
  return (
    <>
      <ContextMenu actionsRef={contextMenuActionsRef}>
        <ContextMenuTrigger render={<div style={{ width: 800, height: 500 }} />}>
          <WorkflowCanvas
            defaultNodes={nodes}
            defaultEdges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => handleNodeSelect(node.id)}
            deleteKeyCode={null}
            onKeyDownCapture={onKeyDownCapture}
            selectionOnDrag={contextMenuType === 'selection'}
            panOnDrag={contextMenuType !== 'selection'}
            onSelectionStart={handleSelectionStart}
            onSelectionChange={handleSelectionChange}
            onSelectionContextMenu={handleSelectionContextMenu}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            onEdgeContextMenu={handleEdgeContextMenu}
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
          <NodeActionsContextMenuContent
            id="node"
            data={initialNodes[0]!.data}
            onClose={() => contextMenuActionsRef.current?.close()}
            showHelpLink={false}
          />
        ) : contextMenuType === 'edge' ? (
          <EdgeContextmenu onClose={() => contextMenuActionsRef.current?.close()} />
        ) : contextMenuType === 'selection' ? (
          <SelectionContextmenu onClose={() => contextMenuActionsRef.current?.close()} />
        ) : null}
      </ContextMenu>
      <input aria-label="Outside canvas input" />
      <CanvasNodesCatalogProbe />
    </>
  )
}
async function setup(props: CanvasProps = {}, commentMode = false) {
  await page.viewport(1000, 700)
  const { queryClient } = createConsoleQueryWrapper({
    appDslVersion: '0.6.0',
    systemFeatures: { enable_collaboration_mode: commentMode },
  })
  // Draft persistence is supplied by the owning editor; graph mutations and history stay real.
  const save = vi.fn(async () => undefined)
  const screen = await render(
    <>
      <button>Before canvas</button>
      <Canvas {...props} />
    </>,
    {
      queryClient,
      initialStoreState: { controlMode: ControlMode.Hand },
      hooksStoreProps: { doSyncWorkflowDraft: save },
      historyStore: { nodes: props.nodes ?? initialNodes, edges: props.edges ?? [] },
    },
  )
  return { ...screen, save }
}

it('admits and releases keyboard focus while keeping mode and zoom shortcuts inside the canvas', async () => {
  const screen = await setup({}, true)
  const before = screen.getByRole('button', { name: 'Before canvas' })
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByRole('button', { name: 'Workflow node' })
  await userEvent.tab()
  await expect.element(before).toHaveFocus()
  await userEvent.tab()
  await expect.element(canvas).toHaveFocus()
  const width = node.element().getBoundingClientRect().width
  expect(width).toBeGreaterThan(0)
  await userEvent.keyboard('{Shift>}[Digit5]{/Shift}')
  await expect.poll(() => node.element().getBoundingClientRect().width).toBeCloseTo(width / 2)
  await userEvent.keyboard('{Shift>}[Digit1]{/Shift}')
  await expect.poll(() => node.element().getBoundingClientRect().width).toBeCloseTo(width)
  for (const [key, mode] of [
    ['v', ControlMode.Pointer],
    ['h', ControlMode.Hand],
    ['c', ControlMode.Comment],
  ] as const) {
    await userEvent.keyboard(key)
    expect(screen.store.getState().controlMode).toBe(mode)
  }
  await userEvent.keyboard('v')
  expect(screen.store.getState().controlMode).toBe(ControlMode.Pointer)
  await userEvent.tab({ shift: true })
  await expect.element(before).toHaveFocus()
  await userEvent.keyboard('hc{Shift>}[Digit5]{/Shift}')
  expect(screen.store.getState().controlMode).toBe(ControlMode.Pointer)
  expect(node.element().getBoundingClientRect().width).toBeCloseTo(width)
  await screen.getByRole('textbox', { name: 'workflow.nodes.note.editor.label' }).click()
  await userEvent.keyboard('hc')
  expect(screen.store.getState().controlMode).toBe(ControlMode.Pointer)
})

it('acquires canvas focus from clicks while leaving native editor undo and outside shortcuts alone', async () => {
  const screen = await setup()
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  await canvas.click({ position: { x: 650, y: 400 } })
  await expect.element(canvas).toHaveFocus()
  await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
  screen.store.getState().flushPendingSync()
  expect(screen.save).toHaveBeenCalledOnce()
  const node = screen.getByRole('button', { name: 'Workflow node' })
  await node.click()
  await expect.element(node).toHaveFocus()
  const prompt = screen.getByRole('textbox', { name: 'Node prompt' })
  await prompt.click()
  await userEvent.keyboard('Draft text')
  await expect.element(prompt).toHaveValue('Draft text')
  await undo()
  await expect.element(prompt).toHaveValue('')
  expect(graphNodes().map((node) => node.id)).toEqual(['node', 'anchor'])
  expect(screen.store.temporal.getState().pastStates).toHaveLength(0)
  await screen.getByRole('button', { name: 'Popup action' }).click()
  await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
  screen.store.getState().flushPendingSync()
  expect(screen.save).toHaveBeenCalledOnce()
  await canvas.click({ position: { x: 650, y: 400 } })
  await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
  screen.store.getState().flushPendingSync()
  expect(screen.save).toHaveBeenCalledTimes(2)
})

it('keeps canvas focus when real deletion and redo remove the focused node', async () => {
  const screen = await setup()
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  const node = screen.getByRole('button', { name: 'Workflow node' })
  await node.click()
  await recordHistory(() => userEvent.keyboard('{Delete}'))
  await expect.element(node).not.toBeInTheDocument()
  await expect.element(canvas).toHaveFocus()
  expect(graphNodes().map((node) => node.id)).toEqual(['anchor'])
  await undo()
  await expect.element(node).toBeInTheDocument()
  await node.click()
  await redo()
  await expect.element(node).not.toBeInTheDocument()
  await expect.element(canvas).toHaveFocus()
  await undo()
  await expect.element(node).toBeInTheDocument()
})

it('lets the production Note editor own text undo and redo', async () => {
  const screen = await setup()
  const note = screen.getByRole('textbox', { name: 'workflow.nodes.note.editor.label' })
  await note.click()
  await userEvent.keyboard('Note text')
  await expect.element(note).toHaveTextContent('Note text')
  await undo()
  await expect.element(note).toBeEmptyDOMElement()
  await redo()
  await expect.element(note).toHaveTextContent('Note text')
  expect(graphNodes().map((node) => node.id)).toEqual(['node', 'anchor'])
  expect(screen.store.temporal.getState().pastStates).toHaveLength(0)
})

it.each(['menu', 'note'] as const)(
  'returns to real canvas undo after the %s dropdown deletes its trigger',
  async (type) => {
    const screen = await setup({
      nodes: initialNodes.map((node) => (node.id === 'node' ? { ...node, type } : node)),
    })
    const more = screen.getByRole('button', { name: 'common.operation.more' })
    await more.click()
    await recordHistory(() =>
      screen.getByRole('menuitem', { name: /common.operation.delete/ }).click(),
    )
    await expect.element(more).not.toBeInTheDocument()
    await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
    expect(graphNodes().map((node) => node.id)).toEqual(['anchor'])
    await undo()
    await expect.element(more).toBeInTheDocument()
    expect(graphNodes().map((node) => node.id)).toEqual(['node', 'anchor'])
  },
)

it('returns to real canvas undo after a node context menu removes its focus target', async () => {
  const screen = await setup({ contextMenuType: 'node' })
  const node = screen.getByRole('button', { name: 'Workflow node' })
  await node.click({ button: 'right' })
  await recordHistory(() =>
    screen.getByRole('menuitem', { name: /common.operation.delete/ }).click(),
  )
  await expect.element(node).not.toBeInTheDocument()
  await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
  await undo()
  await expect.element(node).toBeInTheDocument()
})

it('returns to real canvas undo after deleting an edge through its context menu', async () => {
  const nodes = [
    ...initialNodes,
    createNode({
      id: 'other',
      type: 'default',
      position: { x: 500, y: 300 },
      data: { label: 'Other node' },
    }),
  ]
  const edges = [
    createEdge({
      id: 'edge',
      source: 'node',
      target: 'other',
      sourceHandle: undefined,
      targetHandle: undefined,
      type: 'default',
    }),
  ]
  const screen = await setup({ nodes, edges, contextMenuType: 'edge' })
  const edge = screen.getByTestId('rf__edge-edge')
  await screen.getByLabelText('Outside canvas input').click()
  await edge.click({ button: 'right' })
  await recordHistory(() =>
    screen.getByRole('menuitem', { name: /common.operation.delete/ }).click(),
  )
  await expect.element(edge).not.toBeInTheDocument()
  await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
  expect(graphEdges()).toEqual([])
  await undo()
  await expect.element(edge).toBeInTheDocument()
  expect(graphEdges()).toMatchObject(edges)
  await edge.click({ button: 'right' })
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
})

it('returns to real canvas undo after deleting a native drag selection from its context menu', async () => {
  const nodes = [
    ...initialNodes,
    createNode({
      id: 'other',
      type: 'default',
      ariaLabel: 'Other node',
      position: { x: 500, y: 300 },
      data: { label: 'Other node' },
    }),
  ]
  const screen = await setup({ nodes, contextMenuType: 'selection' })
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 300, y: 120 },
    targetPosition: { x: 700, y: 380 },
    steps: 5,
  })
  await canvas.click({ button: 'right', position: { x: 450, y: 220 } })
  await recordHistory(() =>
    screen.getByRole('menuitem', { name: /common.operation.delete/ }).click(),
  )
  await expect
    .element(screen.getByRole('button', { name: 'Workflow node' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Other node' })).not.toBeInTheDocument()
  await expect.element(canvas).toHaveFocus()
  expect(graphNodes().map((node) => node.id)).toEqual(['anchor'])
  await undo()
  await expect.element(screen.getByRole('button', { name: 'Workflow node' })).toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Other node' })).toBeInTheDocument()
})

it('keeps focus on an outside input when it dismisses a node dropdown', async () => {
  const screen = await setup({
    nodes: initialNodes.map((node) => (node.id === 'node' ? { ...node, type: 'menu' } : node)),
  })
  await screen.getByRole('button', { name: 'common.operation.more' }).click()
  await expect.element(screen.getByRole('menuitem', { name: /workflow.common.copy/ })).toBeVisible()
  const outside = screen.getByRole('textbox', { name: 'Outside canvas input' })
  await outside.click()
  await expect
    .element(screen.getByRole('menuitem', { name: /workflow.common.copy/ }))
    .not.toBeInTheDocument()
  await expect.element(outside).toHaveFocus()
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
    data: { type: BlockEnum.Code, title: 'Source', desc: '' },
  },
  {
    id: 'assigner',
    type: 'connection',
    position: { x: 500, y: 150 },
    data: { type: BlockEnum.VariableAssigner, title: 'Assigner', desc: '' },
  },
]

function VariableConnectionCanvas({ onSelect }: { onSelect: (value: string[]) => void }) {
  const [showPicker, setShowPicker] = useState(false)
  const canvas = useReactFlowStore((state) => state.domNode)
  const { handleNodeSelect } = useNodesInteractions()
  const handleNodeKeyDown = useNodeKeyboardInteractions(handleNodeSelect)

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
  const onSelect = vi.fn()
  const screen = await render(
    <>
      <VariableConnectionCanvas onSelect={onSelect} />
      <textarea aria-label="Outside variable picker" />
    </>,
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

  await userEvent.keyboard('{ArrowDown}')
  await userEvent.keyboard('{Enter}')

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
