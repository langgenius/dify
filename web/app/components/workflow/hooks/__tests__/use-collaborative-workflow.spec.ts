import { act, waitFor } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

const mocks = vi.hoisted(() => {
  const readyCallbacks: Array<(isReady: boolean) => void> = []
  const canApplyLocalGraphMutation = vi.fn()
  return {
    canApplyLocalGraphMutation,
    // The workflow/session the manager is currently connected to. Tests
    // drive it to simulate navigating to another workflow while the hook
    // stays mounted.
    getCurrentAppId: vi.fn(() => 'workflow-a'),
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    // Mirrors the real manager: the callback runs immediately with the
    // current readiness, and again whenever readiness changes.
    onGraphReadyChange: vi.fn((callback: (isReady: boolean) => void) => {
      readyCallbacks.push(callback)
      callback(canApplyLocalGraphMutation())
      return () => {
        const index = readyCallbacks.indexOf(callback)
        if (index !== -1) readyCallbacks.splice(index, 1)
      }
    }),
    readyCallbacks,
  }
})
vi.mock('../../collaboration/core/collaboration-manager', () => ({ collaborationManager: mocks }))

const emitGraphReady = (isReady: boolean) => {
  mocks.readyCallbacks.forEach((callback) => callback(isReady))
}

beforeEach(() => {
  mocks.readyCallbacks.length = 0
  mocks.canApplyLocalGraphMutation.mockReset()
  mocks.getCurrentAppId.mockReset()
  mocks.getCurrentAppId.mockReturnValue('workflow-a')
  mocks.setNodes.mockClear()
  mocks.setEdges.mockClear()
  mocks.onGraphReadyChange.mockClear()
})

const oldNode = createNode({ id: 'old-node', data: { title: 'Old', selected: true } })
const newNode = createNode({ id: 'new-node', data: { title: 'New', selected: true } })
const oldEdge = createEdge({
  id: 'old-edge',
  source: 'old-node',
  target: 'target',
  data: { _connectedNodeIsSelected: true },
})
const newEdge = createEdge({
  id: 'new-edge',
  source: 'new-node',
  target: 'target',
  data: { _connectedNodeIsSelected: true },
})
const setup = (hooksStoreProps?: { doSyncWorkflowDraft: () => Promise<void> }) =>
  renderWorkflowFlowHook(() => useCollaborativeWorkflow(), {
    nodes: [oldNode, createNode({ id: 'target' })],
    edges: [oldEdge],
    ...(hooksStoreProps ? { hooksStoreProps } : {}),
  })

it('holds local mutations until ready while still accepting graph imports', async () => {
  mocks.canApplyLocalGraphMutation.mockReturnValue(false)
  const { result } = setup()
  await waitFor(() =>
    expect(result.current.getState().nodes.map((node) => node.id)).toEqual(['old-node', 'target']),
  )
  act(() => {
    result.current.setNodes([newNode])
    result.current.setEdges([newEdge])
  })
  expect(result.current.getState().nodes.map((node) => node.id)).toEqual(['old-node', 'target'])
  expect(result.current.getState().edges).toMatchObject([oldEdge])
  act(() => {
    result.current.setNodes([newNode], false)
    result.current.setEdges([newEdge], false)
  })
  expect(result.current.getState().nodes).toMatchObject([newNode])
  expect(result.current.getState().edges).toMatchObject([newEdge])
  expect(mocks.setNodes).not.toHaveBeenCalled()
  expect(mocks.setEdges).not.toHaveBeenCalled()

  // Drain the held edits so they do not leak into other tests.
  mocks.canApplyLocalGraphMutation.mockReturnValue(true)
  act(() => emitGraphReady(true))
  expect(result.current.getState().nodes).toMatchObject([newNode])
  expect(result.current.getState().edges).toMatchObject([newEdge])
})

it('updates the local graph while stripping selection state from broadcasts', async () => {
  mocks.canApplyLocalGraphMutation.mockReturnValue(true)
  const { result } = setup()
  await waitFor(() => expect(result.current.getState().nodes).toHaveLength(2))
  act(() => {
    result.current.setNodes([newNode], true, 'user-edit')
    result.current.setEdges([newEdge])
  })
  expect(result.current.getState().nodes).toMatchObject([newNode])
  expect(result.current.getState().edges).toMatchObject([newEdge])
  expect(mocks.setNodes).toHaveBeenCalledTimes(1)
  const [before, after, source] = mocks.setNodes.mock.calls[0]!
  expect(before).toMatchObject([{ id: 'old-node', data: { title: 'Old' } }, { id: 'target' }])
  expect(after).toMatchObject([{ id: 'new-node', data: { title: 'New' } }])
  expect(before[0].data).not.toHaveProperty('selected')
  expect(after[0].data).not.toHaveProperty('selected')
  expect(source).toBe('user-edit')
  expect(mocks.setEdges).toHaveBeenCalledTimes(1)
  const [previousEdges, nextEdges] = mocks.setEdges.mock.calls[0]!
  expect(previousEdges).toMatchObject([{ id: 'old-edge', source: 'old-node', target: 'target' }])
  expect(nextEdges).toMatchObject([{ id: 'new-edge', source: 'new-node', target: 'target' }])
  expect(previousEdges[0].data).not.toHaveProperty('_connectedNodeIsSelected')
  expect(nextEdges[0].data).not.toHaveProperty('_connectedNodeIsSelected')
})

it('replays local edits made while the session was not ready once it becomes ready', async () => {
  mocks.canApplyLocalGraphMutation.mockReturnValue(false)
  const syncMock = vi.fn().mockResolvedValue(undefined)
  const { result } = setup({ doSyncWorkflowDraft: syncMock })
  await waitFor(() =>
    expect(result.current.getState().nodes.map((node) => node.id)).toEqual(['old-node', 'target']),
  )

  // Edit a node (e.g. typing an LLM prompt) and an edge while the session
  // is not ready. The target node object is reused so it is not itself an
  // edit, proving the replay leaves untouched nodes alone.
  const targetNode = result.current.getState().nodes.find((node) => node.id === 'target')!
  const editedNode = createNode({ id: 'old-node', data: { title: 'Edited' } })
  act(() => {
    result.current.setNodes([editedNode, targetNode])
    result.current.setEdges([newEdge])
  })
  // Held, not applied: the store still shows the pre-edit graph.
  expect(result.current.getState().nodes[0]?.data).toMatchObject({ title: 'Old' })
  expect(result.current.getState().edges).toMatchObject([oldEdge])
  expect(mocks.setNodes).not.toHaveBeenCalled()
  expect(mocks.setEdges).not.toHaveBeenCalled()

  // A snapshot import lands before the session is ready (e.g. the server
  // graph arriving on reconnect). It must not wipe the held edit, and the
  // replay must not clobber the imported target node.
  const importedTarget = createNode({ id: 'target', data: { title: 'Imported' } })
  act(() => {
    result.current.setNodes([oldNode, importedTarget], false)
  })
  expect(result.current.getState().nodes[1]?.data).toMatchObject({ title: 'Imported' })

  // The session becomes ready: the held edits land in the store and the
  // CRDT, and a draft sync persists them.
  mocks.canApplyLocalGraphMutation.mockReturnValue(true)
  act(() => emitGraphReady(true))
  expect(result.current.getState().nodes).toMatchObject([
    { id: 'old-node', data: { title: 'Edited' } },
    { id: 'target', data: { title: 'Imported' } },
  ])
  expect(result.current.getState().edges).toMatchObject([newEdge])
  expect(mocks.setNodes).toHaveBeenCalledTimes(1)
  const [before, after, source] = mocks.setNodes.mock.calls[0]!
  expect(before).toMatchObject([
    { id: 'old-node', data: { title: 'Old' } },
    { id: 'target', data: { title: 'Imported' } },
  ])
  expect(after).toMatchObject([
    { id: 'old-node', data: { title: 'Edited' } },
    { id: 'target', data: { title: 'Imported' } },
  ])
  expect(before[0].data).not.toHaveProperty('selected')
  expect(source).toBe('use-collaborative-workflow:replay-pending-nodes')
  expect(mocks.setEdges).toHaveBeenCalledTimes(1)
  const [previousEdges, nextEdges] = mocks.setEdges.mock.calls[0]!
  expect(previousEdges).toMatchObject([{ id: 'old-edge' }])
  expect(nextEdges).toMatchObject([{ id: 'new-edge' }])
  expect(syncMock).toHaveBeenCalledTimes(1)
})

it('drops held edits when the workflow changes before the session becomes ready', async () => {
  mocks.canApplyLocalGraphMutation.mockReturnValue(false)
  const syncMock = vi.fn().mockResolvedValue(undefined)
  const { result } = setup({ doSyncWorkflowDraft: syncMock })
  await waitFor(() =>
    expect(result.current.getState().nodes.map((node) => node.id)).toEqual(['old-node', 'target']),
  )

  // Edit in workflow A while the session is not ready: the edit is held.
  const targetNode = result.current.getState().nodes.find((node) => node.id === 'target')!
  const editedNode = createNode({ id: 'old-node', data: { title: 'Edited in A' } })
  act(() => {
    result.current.setNodes([editedNode, targetNode])
    result.current.setEdges([newEdge])
  })
  expect(result.current.getState().nodes[0]?.data).toMatchObject({ title: 'Old' })
  expect(result.current.getState().edges).toMatchObject([oldEdge])

  // The user navigates to workflow B (the hook stays mounted) and B's
  // session becomes ready. A's held edits must not land on B's graph.
  mocks.getCurrentAppId.mockReturnValue('workflow-b')
  mocks.canApplyLocalGraphMutation.mockReturnValue(true)
  act(() => emitGraphReady(true))

  expect(result.current.getState().nodes).toMatchObject([
    { id: 'old-node', data: { title: 'Old' } },
    { id: 'target' },
  ])
  expect(result.current.getState().edges).toMatchObject([oldEdge])
  expect(mocks.setNodes).not.toHaveBeenCalled()
  expect(mocks.setEdges).not.toHaveBeenCalled()
  expect(syncMock).not.toHaveBeenCalled()
})

it('does not replay held edits from another workflow when the next edit lands', async () => {
  mocks.canApplyLocalGraphMutation.mockReturnValue(false)
  const { result } = setup()
  await waitFor(() =>
    expect(result.current.getState().nodes.map((node) => node.id)).toEqual(['old-node', 'target']),
  )

  // Edit in workflow A while the session is not ready: the edit is held.
  const targetNode = result.current.getState().nodes.find((node) => node.id === 'target')!
  const editedNodeA = createNode({ id: 'old-node', data: { title: 'Edited in A' } })
  act(() => {
    result.current.setNodes([editedNodeA, targetNode])
    result.current.setEdges([newEdge])
  })

  // The user navigates to workflow B, whose session is ready, and edits there.
  mocks.getCurrentAppId.mockReturnValue('workflow-b')
  mocks.canApplyLocalGraphMutation.mockReturnValue(true)
  const editedNodeB = createNode({ id: 'old-node', data: { title: 'Edited in B' } })
  act(() => {
    result.current.setNodes([editedNodeB, targetNode])
  })

  // Only B's edit reaches the graph and the broadcast; A's held edit is dropped.
  expect(result.current.getState().nodes).toMatchObject([
    { id: 'old-node', data: { title: 'Edited in B' } },
    { id: 'target' },
  ])
  expect(result.current.getState().edges).toMatchObject([oldEdge])
  expect(mocks.setNodes).toHaveBeenCalledTimes(1)
  const [before, after] = mocks.setNodes.mock.calls[0]!
  expect(before).toMatchObject([{ id: 'old-node', data: { title: 'Old' } }, { id: 'target' }])
  expect(after).toMatchObject([
    { id: 'old-node', data: { title: 'Edited in B' } },
    { id: 'target' },
  ])
  expect(mocks.setEdges).not.toHaveBeenCalled()
})
