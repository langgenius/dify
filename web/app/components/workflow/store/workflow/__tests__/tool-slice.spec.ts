import { createStore } from 'zustand/vanilla'
import { createToolSlice } from '../tool-slice'

describe('createToolSlice', () => {
  it('tracks tool publish state flags', () => {
    const store = createStore(createToolSlice)

    expect(store.getState().toolPublished).toBe(false)
    expect(store.getState().lastPublishedHasUserInput).toBe(false)

    store.getState().setToolPublished(true)
    store.getState().setLastPublishedHasUserInput(true)

    expect(store.getState().toolPublished).toBe(true)
    expect(store.getState().lastPublishedHasUserInput).toBe(true)
  })
})
