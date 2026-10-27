import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

describe('environment panel exclusivity', () => {
  it('closes other panels when opened and preserves a subsequently opened panel when closed', () => {
    const store = createTestWorkflowStore()
    store.setState({
      showDebugAndPreviewPanel: true,
      showChatVariablePanel: true,
      showGlobalVariablePanel: true,
    })

    store.getState().setShowEnvPanel(true)
    expect(store.getState()).toMatchObject({
      showEnvPanel: true,
      showDebugAndPreviewPanel: false,
      showChatVariablePanel: false,
      showGlobalVariablePanel: false,
    })

    store.getState().setShowGlobalVariablePanel(true)
    store.getState().setShowEnvPanel(false)
    expect(store.getState().showEnvPanel).toBe(false)
    expect(store.getState().showGlobalVariablePanel).toBe(true)
  })
})
