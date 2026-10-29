import { act, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { useReactFlow } from 'reactflow'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { WORKFLOW_DATA_UPDATE } from '../../constants'
import { useWorkflowUpdate } from '../use-workflow-update'

function useUpdateProbe() {
  const [graph, setGraph] = useState<unknown>()
  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((event) => {
    if (typeof event === 'object' && event.type === WORKFLOW_DATA_UPDATE) setGraph(event.payload)
  })
  return { ...useWorkflowUpdate(), flow: useReactFlow(), graph }
}

it('publishes initialized graph data and applies the supplied viewport', async () => {
  const result = {} as { current: ReturnType<typeof useUpdateProbe> }
  function Probe() {
    result.current = useUpdateProbe()
    return null
  }
  renderWorkflowFlowComponent(
    <EventEmitterContextProvider>
      <Probe />
    </EventEmitterContextProvider>,
    {
      reactFlowProps: { fitView: false, defaultViewport: { x: 80, y: 40, zoom: 1.5 } },
    },
  )
  await waitFor(() => expect(result.current.flow.viewportInitialized).toBe(true))

  act(() =>
    result.current.handleUpdateWorkflowCanvas({
      nodes: [createNode({ id: 'source' }), createNode({ id: 'target' })],
      edges: [createEdge({ id: 'edge', source: 'source', target: 'target' })],
      viewport: { x: 10, y: 20, zoom: 0.5 },
    }),
  )
  await waitFor(() =>
    expect(result.current.flow.getViewport()).toEqual({ x: 10, y: 20, zoom: 0.5 }),
  )
  expect(result.current.graph).toMatchObject({
    nodes: [
      {
        id: 'source',
        data: { _connectedSourceHandleIds: ['source'], _connectedTargetHandleIds: [] },
      },
      {
        id: 'target',
        data: { _connectedSourceHandleIds: [], _connectedTargetHandleIds: ['target'] },
      },
    ],
    edges: [{ id: 'edge', source: 'source', target: 'target' }],
  })
})
