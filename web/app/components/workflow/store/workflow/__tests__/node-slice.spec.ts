import { createStore } from 'zustand/vanilla'
import { createNodeSlice } from '../node-slice'

describe('createNodeSlice', () => {
  it('keeps node-level ui defaults and updates transient payloads', () => {
    const store = createStore(createNodeSlice)

    expect(store.getState().showSingleRunPanel).toBe(false)
    expect(store.getState().iterTimes).toBe(1)
    expect(store.getState().loopTimes).toBe(1)
    expect(store.getState().iterParallelLogMap.size).toBe(0)

    store.getState().setConnectingNodePayload({
      nodeId: 'node-1',
      nodeType: 'llm',
      handleType: 'source',
      handleId: 'output',
    })
    store.getState().setPendingSingleRun({
      nodeId: 'node-1',
      action: 'run',
    })

    expect(store.getState().connectingNodePayload).toEqual({
      nodeId: 'node-1',
      nodeType: 'llm',
      handleType: 'source',
      handleId: 'output',
    })
    expect(store.getState().pendingSingleRun).toEqual({
      nodeId: 'node-1',
      action: 'run',
    })
  })
})
