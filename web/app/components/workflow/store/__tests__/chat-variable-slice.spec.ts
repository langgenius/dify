import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

describe('variable panel exclusivity', () => {
  it.each([
    ['setShowChatVariablePanel', 'showChatVariablePanel'],
    ['setShowGlobalVariablePanel', 'showGlobalVariablePanel'],
  ] as const)(
    '%s closes the other panels and a stale close preserves the next active panel',
    (open, visible) => {
      const store = createTestWorkflowStore()
      store.setState({
        showDebugAndPreviewPanel: true,
        showEnvPanel: true,
        showChatVariablePanel: true,
        showGlobalVariablePanel: true,
      })

      store.getState()[open](true)
      expect(store.getState()).toMatchObject({
        showDebugAndPreviewPanel: false,
        showEnvPanel: false,
        showChatVariablePanel: false,
        showGlobalVariablePanel: false,
        [visible]: true,
      })

      store.getState().setShowEnvPanel(true)
      store.getState()[open](false)
      expect(store.getState().showEnvPanel).toBe(true)
      expect(store.getState()[visible]).toBe(false)
    },
  )
})
