import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { collaborationManager } from '../../collaboration/core/collaboration-manager'
import { CUSTOM_ITERATION_START_NODE } from '../../nodes/iteration-start/constants'
import { BlockEnum, ControlMode } from '../../types'
import { useNodeKeyboardInteractions } from '../use-node-keyboard-interactions'

const state = vi.hoisted(() => ({
  readonly: false,
  sync: vi.fn(),
  history: vi.fn(),
  select: vi.fn(),
}))
vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock(),
)
vi.mock('../use-workflow', () => ({
  useNodesReadOnly: () => ({ getNodesReadOnly: () => state.readonly }),
}))
vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: state.sync }),
}))
vi.mock('../use-workflow-history', () => ({
  WorkflowHistoryEvent: { NodeDragStop: 'NodeDragStop' },
  useWorkflowHistory: () => ({ saveStateToHistory: state.history }),
}))

function Canvas() {
  const onKeyDownCapture = useNodeKeyboardInteractions(state.select)
  return (
    <div onKeyDownCapture={onKeyDownCapture}>
      <div role="button" tabIndex={0} className="react-flow__node" data-id="node">
        Node
        <button type="button" data-node-keyboard-target onClick={() => state.select('node')}>
          Select node
        </button>
      </div>
      <div
        role="button"
        tabIndex={0}
        className="react-flow__nodesselection-rect"
        aria-label="Selection"
      />
      <input aria-label="Node title" />
    </div>
  )
}

describe('node keyboard interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    vi.spyOn(collaborationManager, 'canApplyLocalGraphMutation').mockReturnValue(true)
    vi.spyOn(collaborationManager, 'setNodes').mockImplementation(() => {})
    state.readonly = false
    rfState.nodes = [
      createNode({ id: 'node', selected: true, position: { x: 0, y: 0 }, width: 100, height: 80 }),
    ]
    rfState.setNodes.mockImplementation((nodes) => {
      rfState.nodes = nodes
    })
  })

  it('moves from the origin, broadcasts the old and new positions, and saves undo history', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<Canvas />)
    await user.tab()
    await user.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
    expect(rfState.nodes[0]!.position).toEqual({ x: 5, y: 20 })
    expect(collaborationManager.setNodes).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ position: { x: 5, y: 0 } })]),
      expect.arrayContaining([expect.objectContaining({ position: { x: 5, y: 20 } })]),
      'keyboard-node-movement',
    )
    expect(state.sync).toHaveBeenCalledTimes(2)
    expect(state.history).toHaveBeenLastCalledWith('NodeDragStop', { nodeId: 'node' })
  })

  it('selects and deselects the focused node while leaving editor keys alone', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<Canvas />)
    await user.tab()
    await user.keyboard('{Enter}{Escape}')
    expect(state.select.mock.calls).toEqual([
      ['node', false],
      ['node', true],
    ])
    await user.click(screen.getByRole('textbox', { name: 'Node title' }))
    await user.keyboard('{ArrowDown}')
    expect(state.sync).not.toHaveBeenCalled()
  })

  it('moves a Tab-focused unselected node without moving a separate selection', async () => {
    rfState.nodes = [
      createNode({ id: 'node', selected: false, position: { x: 0, y: 0 } }),
      createNode({ id: 'other', selected: true, position: { x: 100, y: 100 } }),
    ]
    const user = userEvent.setup()
    renderWorkflowComponent(<Canvas />)
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(rfState.nodes.map((node) => node.position)).toEqual([
      { x: 5, y: 0 },
      { x: 100, y: 100 },
    ])
    expect(state.sync).toHaveBeenCalledOnce()
    expect(state.history).toHaveBeenCalledWith('NodeDragStop', { nodeId: 'node' })
  })

  it('moves from the title button through collaboration and keeps its native activation', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<Canvas />)
    await user.click(screen.getByRole('button', { name: 'Select node' }))
    await user.keyboard('{ArrowRight}')
    expect(rfState.nodes[0]!.position).toEqual({ x: 5, y: 0 })
    expect(collaborationManager.setNodes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ position: { x: 0, y: 0 } })]),
      expect.arrayContaining([expect.objectContaining({ position: { x: 5, y: 0 } })]),
      'keyboard-node-movement',
    )
    expect(state.sync).toHaveBeenCalledOnce()
    state.select.mockClear()
    await user.keyboard('{Enter} ')
    expect(state.select.mock.calls).toEqual([['node'], ['node']])
  })

  it('keeps selected children stationary relative to a moving selected container', async () => {
    rfState.nodes = [
      createNode({
        id: 'node',
        selected: true,
        data: { type: BlockEnum.Iteration },
        position: { x: 100, y: 100 },
      }),
      createNode({ id: 'child', selected: true, parentId: 'node', position: { x: 30, y: 60 } }),
      createNode({ id: 'other', selected: true, position: { x: 500, y: 500 } }),
    ]
    const user = userEvent.setup()
    renderWorkflowComponent(<Canvas />)
    await user.tab()
    await user.tab()
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(rfState.nodes.map((node) => node.position)).toEqual([
      { x: 105, y: 100 },
      { x: 30, y: 60 },
      { x: 505, y: 500 },
    ])
  })

  it.each(['iteration', 'loop'] as const)(
    'clamps a child to its %s container and skips empty history at the boundary',
    async (type) => {
      rfState.nodes = [
        createNode({
          id: 'parent',
          width: 300,
          height: 250,
          data: { type: type === 'iteration' ? BlockEnum.Iteration : BlockEnum.Loop },
        }),
        createNode({
          id: 'node',
          parentId: 'parent',
          selected: true,
          width: 100,
          height: 80,
          position: { x: 184, y: 150 },
          data: { isInIteration: type === 'iteration', isInLoop: type === 'loop' },
        }),
      ]
      const user = userEvent.setup()
      renderWorkflowComponent(<Canvas />)
      await user.tab()
      await user.keyboard('{ArrowRight}{ArrowDown}')
      expect(rfState.nodes[1]!.position).toEqual({ x: 184, y: 150 })
      expect(state.sync).not.toHaveBeenCalled()
    },
  )

  it.each(['readonly', 'comment', 'locked', 'start'] as const)(
    'does not move in %s state',
    async (mode) => {
      state.readonly = mode === 'readonly'
      if (mode === 'locked') Object.assign(rfState.nodes[0]!, { draggable: false })
      if (mode === 'start') Object.assign(rfState.nodes[0]!, { type: CUSTOM_ITERATION_START_NODE })
      const user = userEvent.setup()
      renderWorkflowComponent(<Canvas />, {
        initialStoreState: {
          controlMode: mode === 'comment' ? ControlMode.Comment : ControlMode.Pointer,
        },
      })
      await user.tab()
      await user.keyboard('{ArrowRight}')
      expect(state.sync).not.toHaveBeenCalled()
      expect(rfState.nodes[0]!.position).toEqual({ x: 0, y: 0 })
    },
  )
})
