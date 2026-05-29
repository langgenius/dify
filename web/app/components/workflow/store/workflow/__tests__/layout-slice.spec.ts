import { createStore } from 'zustand/vanilla'
import { createLayoutSlice } from '../layout-slice'

describe('createLayoutSlice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads persisted panel sizes and maximize state from localStorage', () => {
    localStorage.setItem('workflow-node-panel-width', '460')
    localStorage.setItem('debug-and-preview-panel-width', '520')
    localStorage.setItem('workflow-variable-inpsect-panel-height', '240')
    localStorage.setItem('workflow-canvas-maximize', 'true')

    const store = createStore(createLayoutSlice)

    expect(store.getState().nodePanelWidth).toBe(460)
    expect(store.getState().previewPanelWidth).toBe(520)
    expect(store.getState().variableInspectPanelHeight).toBe(240)
    expect(store.getState().maximizeCanvas).toBe(true)
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
