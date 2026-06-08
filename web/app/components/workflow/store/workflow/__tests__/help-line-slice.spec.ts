import { createStore } from 'zustand/vanilla'
import { createHelpLineSlice } from '../help-line-slice'

describe('createHelpLineSlice', () => {
  it('starts empty and updates both guideline positions', () => {
    const store = createStore(createHelpLineSlice)

    expect(store.getState().helpLineHorizontal).toBeUndefined()
    expect(store.getState().helpLineVertical).toBeUndefined()

    store.getState().setHelpLineHorizontal({ top: 12, left: 0, width: 420 })
    store.getState().setHelpLineVertical({ top: 0, left: 24, height: 320 })

    expect(store.getState().helpLineHorizontal).toEqual({ top: 12, left: 0, width: 420 })
    expect(store.getState().helpLineVertical).toEqual({ top: 0, left: 24, height: 320 })
  })
})
