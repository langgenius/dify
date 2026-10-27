import type { NodeProps } from 'reactflow'
import type { Edge, Node } from '../../types'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createPortal } from 'react-dom'
import { ReactFlowProvider, useEdges, useNodes, useStoreApi, useViewport } from 'reactflow'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import {
  CANVAS_NODES_STATUS_NAME,
  CanvasNodesCatalogProbe,
} from '../../__tests__/canvas-nodes-catalog-probe'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { CUSTOM_NODE } from '../../constants'
import { BlockEnum, ControlMode } from '../../types'
import { WorkflowCanvas } from '../workflow-canvas'

const mockGetLayoutByELK = vi.hoisted(() => vi.fn())

vi.mock('../../utils/elk-layout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/elk-layout')>()),
  getLayoutByELK: (...args: unknown[]) => mockGetLayoutByELK(...args),
}))

let flowStore: ReturnType<typeof useStoreApi>

function WorkflowNode({ data }: NodeProps) {
  return <span>{data.title as string}</span>
}

const nodeTypes = { [CUSTOM_NODE]: WorkflowNode }

function CanvasEdgesProbe() {
  const edges = useEdges()
  return <output aria-label="Canvas edges">{edges.map((edge) => edge.id).join(',')}</output>
}

function CanvasStateProbe() {
  const nodes = useNodes<{ _dimmed?: boolean }>()
  const viewport = useViewport()
  return (
    <>
      <output aria-label="Dimmed canvas nodes">
        {nodes
          .filter((node) => node.data._dimmed)
          .map((node) => node.id)
          .join(',')}
      </output>
      <output aria-label="Canvas node positions">
        {nodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).join(',')}
      </output>
      <output aria-label="Canvas viewport">{`${viewport.x}:${viewport.y}:${viewport.zoom}`}</output>
    </>
  )
}

function Canvas({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  flowStore = useStoreApi()
  return (
    <>
      <WorkflowCanvas nodes={nodes} edges={edges} nodeTypes={nodeTypes} deleteKeyCode={null}>
        <input aria-label="Node name" />
        <textarea aria-label="Node prompt" />
        <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Note">
          <span>Note content</span>
        </div>
        <button type="button" onKeyDown={(event) => event.preventDefault()}>
          Handled by a local widget
        </button>
        {createPortal(<button type="button">Popup action</button>, document.body)}
      </WorkflowCanvas>
      <CanvasNodesCatalogProbe />
      <CanvasEdgesProbe />
      <CanvasStateProbe />
      <button type="button">Outside canvas</button>
    </>
  )
}

const selectedNode = (id = 'node-1') =>
  createNode({
    id,
    width: 240,
    height: 80,
    selected: true,
    ariaLabel: `Node ${id}`,
    data: { type: BlockEnum.Code, title: `Node ${id}`, selected: true },
  })

function renderCanvas({
  nodes = [selectedNode()],
  edges = [],
  readOnly = false,
  platform = 'windows',
}: {
  nodes?: Node[]
  edges?: Edge[]
  readOnly?: boolean
  platform?: 'mac' | 'windows'
} = {}) {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '1.0.0' })
  seedModelProviderQueries(queryClient)
  seedAppDslVersion(queryClient, '1.0.0')
  const sync = vi.fn(async () => null)
  const rendered = renderWorkflowComponent(
    <HotkeysProvider defaultOptions={{ hotkey: { platform } }}>
      <ReactFlowProvider>
        <Canvas nodes={nodes} edges={edges} />
      </ReactFlowProvider>
    </HotkeysProvider>,
    {
      queryClient,
      initialStoreState: { canvasReadOnly: readOnly },
      historyStore: { nodes, edges },
      hooksStoreProps: { doSyncWorkflowDraft: sync },
    },
  )
  return { ...rendered, sync }
}

function focusCanvas() {
  const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
  act(() => canvas.focus())
  return canvas
}

const canvasNodeIds = () =>
  screen
    .getByLabelText(CANVAS_NODES_STATUS_NAME, { selector: 'output' })
    .textContent!.split(',')
    .filter(Boolean)

describe('Workflow canvas commands', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await navigator.clipboard.writeText('')
    mockGetLayoutByELK.mockResolvedValue({
      nodes: new Map(),
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    })
  })

  afterEach(() => {
    document.getSelection()?.removeAllRanges()
  })

  it.each(['mac', 'windows'] as const)(
    'owns save and mode commands only while its canvas is focused on %s',
    async (platform) => {
      const user = userEvent.setup()
      const { store, sync } = renderCanvas({ platform })
      const mod = platform === 'mac' ? 'Meta' : 'Control'
      focusCanvas()

      await user.keyboard('c')
      expect(store.getState().controlMode).toBe(ControlMode.Comment)
      await user.keyboard('v')
      expect(store.getState().controlMode).toBe(ControlMode.Pointer)
      await user.keyboard(`h{${mod}>}s{/${mod}}`)
      expect(store.getState().controlMode).toBe(ControlMode.Hand)
      act(() => store.getState().flushPendingSync())
      expect(sync).toHaveBeenCalledOnce()

      await user.click(screen.getByRole('button', { name: 'Popup action' }))
      await user.keyboard(`v{${mod}>}s{/${mod}}`)
      await user.click(screen.getByRole('button', { name: 'Outside canvas' }))
      await user.keyboard(`c{${mod}>}s{/${mod}}`)
      act(() => store.getState().flushPendingSync())

      expect(store.getState().controlMode).toBe(ControlMode.Hand)
      expect(sync).toHaveBeenCalledOnce()
    },
  )

  it.each(['Node name', 'Node prompt', 'Note', 'Note content'])(
    'leaves editor shortcuts and native defaults to %s',
    (name) => {
      const { store, sync } = renderCanvas()
      const editor =
        name === 'Note content' ? screen.getByText(name) : screen.getByRole('textbox', { name })

      for (const key of ['s', 'z', 'c', 'v']) {
        const event = new KeyboardEvent('keydown', {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        fireEvent(editor, event)
        fireEvent.keyUp(editor, { key, ctrlKey: true })
        expect(event.defaultPrevented).toBe(false)
      }
      const deletion = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
        cancelable: true,
      })
      fireEvent(editor, deletion)
      expect(deletion.defaultPrevented).toBe(false)

      act(() => store.getState().flushPendingSync())

      expect(store.getState().controlMode).toBe(ControlMode.Pointer)
      expect(canvasNodeIds()).toEqual(['node-1*'])
      expect(store.getState().clipboardElements).toEqual([])
      expect(sync).not.toHaveBeenCalled()
    },
  )

  it('ignores locally claimed and composing events', async () => {
    const user = userEvent.setup()
    const { store } = renderCanvas()

    await user.click(screen.getByRole('button', { name: 'Handled by a local widget' }))
    await user.keyboard('h')
    expect(store.getState().controlMode).toBe(ControlMode.Pointer)

    const canvas = focusCanvas()
    const composingMode = new KeyboardEvent('keydown', {
      key: 'h',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(canvas, composingMode)

    expect(composingMode.defaultPrevented).toBe(false)
    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
  })

  it('consumes owned repeats while duplicating the selected node only once', async () => {
    renderCanvas()
    const canvas = focusCanvas()

    for (const repeat of [false, true, true]) {
      const event = new KeyboardEvent('keydown', {
        key: 'd',
        ctrlKey: true,
        repeat,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(canvas, event)
      expect(event.defaultPrevented).toBe(true)
    }
    fireEvent.keyUp(canvas, { key: 'd', ctrlKey: true })

    await waitFor(() => expect(canvasNodeIds()).toHaveLength(2))
    expect(new Set(canvasNodeIds()).size).toBe(2)
  })

  it('leaves editing commands unclaimed but still changes the real viewport on readonly canvas', async () => {
    const user = userEvent.setup()
    const { store, sync } = renderCanvas({ readOnly: true })
    const canvas = focusCanvas()

    for (const key of ['s', 'd', 'o', 'z']) {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(canvas, event)
      fireEvent.keyUp(canvas, { key, ctrlKey: true })
      expect(event.defaultPrevented).toBe(false)
    }
    const deletion = new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
      cancelable: true,
    })
    fireEvent(canvas, deletion)
    expect(deletion.defaultPrevented).toBe(false)

    act(() => store.getState().flushPendingSync())
    expect(canvasNodeIds()).toEqual(['node-1*'])
    expect(store.getState().clipboardElements).toEqual([])
    expect(store.temporal.getState().pastStates).toEqual([])
    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
    expect(sync).not.toHaveBeenCalled()

    await user.keyboard('{Control>}={/Control}')
    await waitFor(() =>
      expect(screen.getByLabelText('Canvas viewport')).toHaveTextContent('0:0:1.1'),
    )
    expect(sync).not.toHaveBeenCalled()
  })

  it('dims unrelated real nodes only while Shift is held with canvas focus', async () => {
    const user = userEvent.setup()
    const unrelatedNode = createNode({
      id: 'node-2',
      width: 240,
      height: 80,
      position: { x: 320, y: 0 },
      data: { type: BlockEnum.Code, title: 'Node node-2', selected: false },
    })
    renderCanvas({ nodes: [selectedNode(), unrelatedNode] })
    focusCanvas()

    await user.keyboard('{Shift>}')
    await waitFor(() =>
      expect(screen.getByLabelText('Dimmed canvas nodes')).toHaveTextContent('node-2'),
    )

    act(() => screen.getByRole('textbox', { name: 'Node prompt' }).focus())
    await waitFor(() => expect(screen.getByLabelText('Dimmed canvas nodes')).toBeEmptyDOMElement())
    await user.keyboard('{/Shift}{Shift>}{/Shift}')
    expect(screen.getByLabelText('Dimmed canvas nodes')).toBeEmptyDOMElement()
  })

  it('updates the real editable viewport and reaches the draft sync boundary', async () => {
    const user = userEvent.setup()
    const { store, sync } = renderCanvas()
    focusCanvas()

    await user.keyboard('{Control>}={/Control}')
    await waitFor(() =>
      expect(screen.getByLabelText('Canvas viewport')).toHaveTextContent('0:0:1.1'),
    )
    act(() => store.getState().flushPendingSync())

    expect(sync).toHaveBeenCalledOnce()
  })

  it('organizes real canvas nodes through the owner and syncs the updated positions', async () => {
    const user = userEvent.setup()
    const secondNode = createNode({
      id: 'node-2',
      width: 240,
      height: 80,
      position: { x: 320, y: 0 },
      data: { type: BlockEnum.Code, title: 'Node node-2', selected: false },
    })
    mockGetLayoutByELK.mockResolvedValueOnce({
      nodes: new Map([
        ['node-1', { x: 100, y: 120, width: 240, height: 80, layer: 0 }],
        ['node-2', { x: 500, y: 120, width: 240, height: 80, layer: 1 }],
      ]),
      bounds: { minX: 100, minY: 120, maxX: 740, maxY: 200 },
    })
    const { store, sync } = renderCanvas({ nodes: [selectedNode(), secondNode] })
    focusCanvas()

    await user.keyboard('{Control>}o{/Control}')

    await waitFor(() =>
      expect(screen.getByLabelText('Canvas node positions')).toHaveTextContent(
        'node-1:100:120,node-2:500:120',
      ),
    )
    await waitFor(() => {
      act(() => store.getState().flushPendingSync())
      expect(sync).toHaveBeenCalledOnce()
    })
  })

  it('copies a selected real node to the clipboard and pastes a real clone', async () => {
    const user = userEvent.setup()
    const { store } = renderCanvas()
    focusCanvas()

    await user.keyboard('{Control>}c{/Control}')

    expect(store.getState().clipboardElements.map((node) => node.id)).toEqual(['node-1'])
    await waitFor(async () => {
      const clipboard = JSON.parse(await navigator.clipboard.readText()) as {
        nodes: Array<{ id: string }>
      }
      expect(clipboard.nodes.map((node) => node.id)).toEqual(['node-1'])
    })

    await user.keyboard('{Control>}v{/Control}')
    await waitFor(() => expect(canvasNodeIds()).toHaveLength(2))
    const pastedNodeIds = canvasNodeIds().map((nodeId) => nodeId.replace(/\*$/, ''))
    expect(pastedNodeIds).toContain('node-1')
    expect(new Set(pastedNodeIds).size).toBe(2)
  })

  it('uses real graph history and disables undo while debug preview is open', async () => {
    const user = userEvent.setup()
    const retainedNode = createNode({
      id: 'node-2',
      width: 240,
      height: 80,
      position: { x: 320, y: 0 },
      data: { type: BlockEnum.Code, title: 'Node node-2', selected: false },
    })
    const { store } = renderCanvas({ nodes: [selectedNode(), retainedNode] })
    const canvas = focusCanvas()

    await user.keyboard('{Delete}')
    expect(canvasNodeIds()).toEqual(['node-2'])
    await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))

    act(() => store.setState({ showDebugAndPreviewPanel: true }))
    const blockedUndo = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(canvas, blockedUndo)
    fireEvent.keyUp(canvas, { key: 'z', ctrlKey: true })
    expect(blockedUndo.defaultPrevented).toBe(false)
    expect(canvasNodeIds()).toEqual(['node-2'])

    act(() => store.setState({ showDebugAndPreviewPanel: false }))
    await user.keyboard('{Control>}z{/Control}')
    expect(canvasNodeIds()).toEqual(['node-1*', 'node-2'])
    focusCanvas()
    const redo = new KeyboardEvent('keydown', {
      key: 'y',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(canvas, redo)
    fireEvent.keyUp(canvas, { key: 'y', ctrlKey: true })
    expect(redo.defaultPrevented).toBe(true)
    await waitFor(() => expect(canvasNodeIds()).toEqual(['node-2']))
  })

  it('deletes a selected edge without deleting unselected nodes', async () => {
    const user = userEvent.setup()
    const nodes = [
      createNode({
        id: 'source',
        width: 240,
        height: 80,
        data: { type: BlockEnum.Code, title: 'Source', selected: false },
      }),
      createNode({
        id: 'target',
        width: 240,
        height: 80,
        position: { x: 300, y: 0 },
        data: { type: BlockEnum.Code, title: 'Target', selected: false },
      }),
    ]
    renderCanvas({
      nodes,
      edges: [
        createEdge({ id: 'selected-edge', source: 'source', target: 'target', selected: true }),
      ],
    })
    focusCanvas()

    await user.keyboard('{Delete}')

    expect(canvasNodeIds()).toEqual(['source', 'target'])
    expect(screen.getByLabelText('Canvas edges')).toBeEmptyDOMElement()
  })

  it('preserves text selection copying unless the real canvas selection is bundled', async () => {
    const user = userEvent.setup()
    const { store } = renderCanvas()
    const canvas = focusCanvas()
    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Note content'))
    selection.addRange(range)

    await user.keyboard('{Control>}c{/Control}')
    expect(store.getState().clipboardElements).toEqual([])

    act(() => {
      const nodes = flowStore.getState().getNodes()
      flowStore
        .getState()
        .setNodes(nodes.map((node) => ({ ...node, data: { ...node.data, _isBundled: true } })))
    })
    const bundledCopy = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(canvas, bundledCopy)
    fireEvent.keyUp(canvas, { key: 'c', ctrlKey: true })

    expect(bundledCopy.defaultPrevented).toBe(true)
    expect(store.getState().clipboardElements.map((node) => node.id)).toEqual(['node-1'])
  })
})
