import type { NodeProps } from 'reactflow'
import type { Node } from '../../types'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { CUSTOM_NODE } from '../../constants'
import { CUSTOM_ITERATION_START_NODE } from '../../nodes/iteration-start/constants'
import { WorkflowCanvas } from '../../shortcuts/workflow-canvas'
import { BlockEnum, ControlMode } from '../../types'
import { useNodeKeyboardInteractions } from '../use-node-keyboard-interactions'
import { useNodesInteractions } from '../use-nodes-interactions'

let flowStore: ReturnType<typeof useStoreApi>
const getNodes = () => flowStore.getState().getNodes()
const node = (overrides: Parameters<typeof createNode>[0] = {}) =>
  createNode({
    id: 'node',
    selected: true,
    width: 100,
    height: 80,
    ...overrides,
    ariaLabel: `Node ${overrides.id ?? 'node'}`,
  })
const focusNode = async () => {
  const target = await screen.findByRole('button', { name: 'Node node' })
  act(() => target.focus())
}

// Node content is outside the keyboard handler contract. ReactFlow owns the actual
// focusable node wrappers; the production canvas, selection and history stay real.
function NodeContent({ id }: NodeProps) {
  const { handleNodeSelect } = useNodesInteractions()
  return (
    <>
      <button type="button" className="nodrag" onClick={() => handleNodeSelect(id)}>
        Inspect {id}
      </button>
      <input className="nodrag" aria-label={`Title ${id}`} />
    </>
  )
}
const nodeTypes = {
  [CUSTOM_NODE]: NodeContent,
  [CUSTOM_ITERATION_START_NODE]: NodeContent,
}
function Canvas({ nodes }: { nodes: Node[] }) {
  flowStore = useStoreApi()
  const { handleNodeSelect } = useNodesInteractions()
  const onKeyDownCapture = useNodeKeyboardInteractions(handleNodeSelect)
  return (
    <WorkflowCanvas
      nodes={nodes}
      nodeTypes={nodeTypes}
      onKeyDownCapture={onKeyDownCapture}
      deleteKeyCode={null}
    />
  )
}
function setup({
  nodes = [node()],
  initialStoreState,
}: {
  nodes?: Node[]
  initialStoreState?: NonNullable<
    Parameters<typeof renderWorkflowComponent>[1]
  >['initialStoreState']
} = {}) {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedAppDslVersion(queryClient, '1.0.0')
  const sync = vi.fn(async () => null)
  const rendered = renderWorkflowComponent(
    <ReactFlowProvider>
      <Canvas nodes={nodes} />
    </ReactFlowProvider>,
    {
      queryClient,
      initialStoreState,
      historyStore: { nodes, edges: [] },
      hooksStoreProps: { doSyncWorkflowDraft: sync },
    },
  )
  return { ...rendered, sync, user: userEvent.setup() }
}

it('moves from the origin, syncs the draft and restores positions through canvas undo and redo', async () => {
  const { user, store, sync } = setup()
  await focusNode()
  await user.keyboard('{ArrowRight}')
  expect(getNodes()[0]!.position).toEqual({ x: 5, y: 0 })
  await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
  expect(getNodes()[0]!.position).toEqual({ x: 5, y: 20 })
  act(() => store.getState().flushPendingSync())
  expect(sync).toHaveBeenCalledOnce()
  await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))
  // Undo belongs to the canvas scope; node movement retains its own key handler.
  act(() => screen.getByRole('region', { name: 'app.types.workflow' }).focus())
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await user.keyboard(`{${mod}>}z{/${mod}}`)
  expect(getNodes()[0]!.position).toEqual({ x: 0, y: 0 })
  await user.keyboard(`{${mod}>}{Shift>}z{/Shift}{/${mod}}`)
  expect(getNodes()[0]!.position).toEqual({ x: 5, y: 20 })
})

it.each([false, true])(
  'selects and deselects a focused node with readonly=%s',
  async (readonly) => {
    const { user, store } = setup({
      nodes: [node({ selected: false })],
      initialStoreState: { canvasReadOnly: readonly },
    })
    await focusNode()
    await user.keyboard('{Enter}')
    expect(getNodes()[0]).toMatchObject({ selected: true, data: { selected: true } })
    expect(store.getState().pendingNodePanelFocusId).toBe('node')
    await user.keyboard('{Escape}')
    expect(getNodes()[0]).toMatchObject({ selected: false, data: { selected: false } })
    expect(store.getState().pendingNodePanelFocusId).toBeUndefined()
    await user.keyboard(' ')
    expect(getNodes()[0]).toMatchObject({ selected: true, data: { selected: true } })
    expect(store.getState().pendingNodePanelFocusId).toBe('node')
  },
)

it('moves a focused unselected node without moving a separate selection', async () => {
  const { user } = setup({
    nodes: [node({ selected: false }), node({ id: 'other', position: { x: 100, y: 100 } })],
  })
  await focusNode()
  await user.keyboard('{ArrowRight}')
  expect(getNodes().map((node) => node.position)).toEqual([
    { x: 5, y: 0 },
    { x: 100, y: 100 },
  ])
})

it('leaves editor and independent button keys to their controls', async () => {
  const { user, store, sync } = setup({ nodes: [node({ selected: false })] })
  await user.click(await screen.findByRole('textbox', { name: 'Title node' }))
  await user.type(screen.getByRole('textbox', { name: 'Title node' }), 'Draft')
  await user.keyboard('{ArrowLeft}x')
  expect(screen.getByRole('textbox', { name: 'Title node' })).toHaveValue('Drafxt')
  act(() => screen.getByRole('button', { name: 'Inspect node' }).focus())
  await user.keyboard('{ArrowRight}')
  expect(getNodes()[0]!.selected).toBe(false)
  await user.keyboard('{Enter}')
  expect(getNodes()[0]).toMatchObject({
    selected: true,
    data: { selected: true },
    position: { x: 0, y: 0 },
  })
  act(() => store.getState().flushPendingSync())
  expect(sync).not.toHaveBeenCalled()
})

it('moves selected containers and peers without moving their children twice', async () => {
  const { user } = setup({
    nodes: [
      node({ data: { type: BlockEnum.Iteration }, position: { x: 100, y: 100 } }),
      node({ id: 'child', parentId: 'node', position: { x: 30, y: 60 } }),
      node({ id: 'other', position: { x: 500, y: 500 } }),
    ],
  })
  await focusNode()
  await user.keyboard('{ArrowRight}')
  expect(getNodes().map((node) => node.position)).toEqual([
    { x: 105, y: 100 },
    { x: 30, y: 60 },
    { x: 505, y: 500 },
  ])
})

it.each([BlockEnum.Iteration, BlockEnum.Loop])(
  'clamps a child to its %s container without syncing an unchanged draft',
  async (type) => {
    const { user, store, sync } = setup({
      nodes: [
        node({ id: 'parent', selected: false, width: 300, height: 250, data: { type } }),
        node({
          parentId: 'parent',
          position: { x: 184, y: 150 },
          data: {
            isInIteration: type === BlockEnum.Iteration,
            isInLoop: type === BlockEnum.Loop,
          },
        }),
      ],
    })
    await focusNode()
    await user.keyboard('{ArrowRight}{ArrowDown}')
    expect(getNodes()[1]!.position).toEqual({ x: 184, y: 150 })
    act(() => store.getState().flushPendingSync())
    expect(sync).not.toHaveBeenCalled()
  },
)

it.each(['readonly', 'comment', 'locked', 'start'] as const)(
  'does not move in %s state',
  async (mode) => {
    const { user, store, sync } = setup({
      nodes: [
        node({
          draggable: mode !== 'locked',
          type: mode === 'start' ? CUSTOM_ITERATION_START_NODE : CUSTOM_NODE,
        }),
      ],
      initialStoreState: {
        canvasReadOnly: mode === 'readonly',
        controlMode: mode === 'comment' ? ControlMode.Comment : ControlMode.Pointer,
      },
    })
    await focusNode()
    await user.keyboard('{ArrowRight}')
    expect(getNodes()[0]!.position).toEqual({ x: 0, y: 0 })
    act(() => store.getState().flushPendingSync())
    expect(sync).not.toHaveBeenCalled()
  },
)
