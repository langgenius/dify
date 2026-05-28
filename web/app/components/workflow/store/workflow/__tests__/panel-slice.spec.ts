import { createStore } from 'zustand/vanilla'
import { createPanelSlice } from '../panel-slice'

describe('createPanelSlice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses the persisted panel width when present', () => {
    localStorage.setItem('workflow-node-panel-width', '480')

    const store = createStore(createPanelSlice)

    expect(store.getState().panelWidth).toBe(480)
  })

  it('updates panel visibility and context menus through the slice setters', () => {
    const store = createStore(createPanelSlice)

    store.getState().setShowFeaturesPanel(true)
    store.getState().setShowDebugAndPreviewPanel(true)
    store.getState().setContextMenuTarget({ type: 'edge', edgeId: 'edge-1' })

    expect(store.getState().showFeaturesPanel).toBe(true)
    expect(store.getState().showDebugAndPreviewPanel).toBe(true)
    expect(store.getState().contextMenuTarget).toEqual({ type: 'edge', edgeId: 'edge-1' })
  })
})
