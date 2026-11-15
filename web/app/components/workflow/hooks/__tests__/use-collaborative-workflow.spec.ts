import { act, waitFor } from '@testing-library/react'
import { createExternalAgentWorkflowPreviewData } from '@/features/agent-v2/external-agent/workflow-preview/defaults'
import { createExternalAgentAsset } from '@/test/console/external-agents'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

const mocks = vi.hoisted(() => ({
  canApplyLocalGraphMutation: vi.fn(),
  setNodes: vi.fn(),
  setEdges: vi.fn(),
}))
vi.mock('../../collaboration/core/collaboration-manager', () => ({ collaborationManager: mocks }))

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
const setup = () =>
  renderWorkflowFlowHook(() => useCollaborativeWorkflow(), {
    nodes: [oldNode, createNode({ id: 'target' })],
    edges: [oldEdge],
  })

it('blocks local mutations until ready while still accepting graph imports', async () => {
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

it('broadcasts external agent configuration and its connections through edits', async () => {
  mocks.canApplyLocalGraphMutation.mockReturnValue(true)
  const { result } = setup()
  await waitFor(() => expect(result.current.getState().nodes).toHaveLength(2))
  const originalNodes = result.current.getState().nodes
  const externalAgent = createNode({
    id: 'external-agent',
    data: {
      type: BlockEnum.Agent,
      ...createExternalAgentWorkflowPreviewData(createExternalAgentAsset()),
      agent_task: 'Review {{#old-node.contract#}}.',
    },
  })
  const connection = createEdge({
    id: 'external-agent-connection',
    source: oldNode.id,
    target: externalAgent.id,
  })
  act(() => {
    result.current.setNodes([...originalNodes, externalAgent])
    result.current.setEdges([oldEdge, connection])
  })
  expect(mocks.setNodes).toHaveBeenLastCalledWith(
    [expect.objectContaining({ id: oldNode.id }), expect.objectContaining({ id: 'target' })],
    [
      expect.objectContaining({ id: oldNode.id }),
      expect.objectContaining({ id: 'target' }),
      expect.objectContaining(externalAgent),
    ],
    expect.any(String),
  )
  expect(mocks.setEdges).toHaveBeenLastCalledWith(
    [expect.objectContaining({ id: oldEdge.id })],
    [expect.objectContaining({ id: oldEdge.id }), expect.objectContaining(connection)],
  )

  const editedAgent = {
    ...externalAgent,
    data: {
      ...externalAgent.data,
      agent_task: 'Summarize the contract risks.',
      external_wait: {
        enabled: true,
        wait_seconds: 1200,
        on_timeout: 'request_cancellation',
        additional_retries: 2,
        retry_interval_seconds: 30,
      },
    },
  }
  act(() => {
    result.current.setNodes([...originalNodes, editedAgent])
  })
  expect(mocks.setNodes).toHaveBeenLastCalledWith(
    expect.arrayContaining([expect.objectContaining(externalAgent)]),
    expect.arrayContaining([expect.objectContaining(editedAgent)]),
    expect.any(String),
  )
})
