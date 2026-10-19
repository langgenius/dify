import { act, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { createNode, createWorkflowRunningData } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { useNodeDataUpdate } from '../use-node-data-update'

const setup = (readonly = false) => {
  const sync = vi.fn().mockResolvedValue(undefined)
  const rendered = renderWorkflowFlowHook(
    () => ({ ...useNodeDataUpdate(), nodes: useNodes<{ value: string }>() }),
    {
      nodes: [
        createNode({ id: 'node-1', data: { title: 'Node 1', value: 'original' } }),
        createNode({ id: 'node-2', data: { title: 'Node 2', value: 'untouched' } }),
      ],
      hooksStoreProps: { doSyncWorkflowDraft: sync },
      initialStoreState: readonly ? { workflowRunningData: createWorkflowRunningData() } : {},
    },
  )
  return { ...rendered, sync }
}

it('merges edits into the target node and saves only when draft synchronization is requested', async () => {
  const { result, store, sync } = setup()
  await waitFor(() => expect(result.current.nodes).toHaveLength(2))
  act(() =>
    result.current.handleNodeDataUpdate({ id: 'node-1', data: { value: 'updated', extra: true } }),
  )
  await waitFor(() =>
    expect(result.current.nodes.find((node) => node.id === 'node-1')?.data).toMatchObject({
      title: 'Node 1',
      value: 'updated',
      extra: true,
    }),
  )
  expect(result.current.nodes.find((node) => node.id === 'node-2')?.data).toMatchObject({
    title: 'Node 2',
    value: 'untouched',
  })
  expect(sync).not.toHaveBeenCalled()
  act(() =>
    result.current.handleNodeDataUpdateWithSyncDraft({ id: 'node-1', data: { value: 'saved' } }),
  )
  expect(sync).not.toHaveBeenCalled()
  act(() => store.getState().flushPendingSync())
  expect(sync).toHaveBeenCalledOnce()
  expect(result.current.nodes.find((node) => node.id === 'node-1')?.data).toMatchObject({
    value: 'saved',
    extra: true,
  })
})

it('updates the graph and immediately saves with the requested error policy and callback', async () => {
  const { result, sync } = setup()
  const callback = { onSuccess: vi.fn() }
  await waitFor(() => expect(result.current.nodes).toHaveLength(2))
  act(() =>
    result.current.handleNodeDataUpdateWithSyncDraft(
      { id: 'node-1', data: { value: 'saved' } },
      { sync: true, notRefreshWhenSyncError: true, callback },
    ),
  )
  expect(result.current.nodes.find((node) => node.id === 'node-1')?.data.value).toBe('saved')
  expect(sync).toHaveBeenCalledExactlyOnceWith(true, callback)
})

it('preserves graph data and does not schedule a save while the workflow is running', async () => {
  const { result, store, sync } = setup(true)
  await waitFor(() => expect(result.current.nodes).toHaveLength(2))
  act(() =>
    result.current.handleNodeDataUpdateWithSyncDraft({ id: 'node-1', data: { value: 'blocked' } }),
  )
  act(() => store.getState().flushPendingSync())
  expect(result.current.nodes.find((node) => node.id === 'node-1')?.data.value).toBe('original')
  expect(sync).not.toHaveBeenCalled()
})
