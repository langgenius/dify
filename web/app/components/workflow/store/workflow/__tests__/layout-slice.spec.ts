import { createStore } from 'zustand/vanilla'
import { createLayoutSlice } from '../layout-slice'

describe('createLayoutSlice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses static panel defaults', () => {
    localStorage.setItem('workflow-node-panel-width', '460')
    localStorage.setItem('debug-and-preview-panel-width', '520')
    localStorage.setItem('workflow-variable-inpsect-panel-height', '240')

    const store = createStore(createLayoutSlice)

    expect(store.getState().nodePanelWidth).toBe(400)
    expect(store.getState().previewPanelWidth).toBe(400)
    expect(store.getState().variableInspectPanelHeight).toBe(320)
  })

  it('updates canvas and panel dimensions through the slice setters', () => {
    const store = createStore(createLayoutSlice)

    store.getState().setWorkflowCanvasWidth(1280)
    store.getState().setWorkflowCanvasHeight(720)
    store.getState().setBottomPanelWidth(640)
    store.getState().setBottomPanelHeight(360)

    expect(store.getState().workflowCanvasWidth).toBe(1280)
    expect(store.getState().workflowCanvasHeight).toBe(720)
    expect(store.getState().bottomPanelWidth).toBe(640)
    expect(store.getState().bottomPanelHeight).toBe(360)
  })
})
