import type { ConversationVariable } from '@/app/components/workflow/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

function createStore() {
  return createTestWorkflowStore()
}

describe('Chat Variable Slice', () => {
  describe('setShowChatVariablePanel', () => {
    it('should hide other panels when opening', () => {
      const store = createStore()
      store.getState().setShowDebugAndPreviewPanel(true)
      store.getState().setShowEnvPanel(true)

      store.getState().setShowChatVariablePanel(true)

      const state = store.getState()
      expect(state.showChatVariablePanel).toBe(true)
      expect(state.showDebugAndPreviewPanel).toBe(false)
      expect(state.showEnvPanel).toBe(false)
      expect(state.showGlobalVariablePanel).toBe(false)
    })

    it('should only close itself when setting false', () => {
      const store = createStore()
      store.getState().setShowChatVariablePanel(true)

      store.getState().setShowChatVariablePanel(false)

      expect(store.getState().showChatVariablePanel).toBe(false)
    })
  })

  describe('setShowGlobalVariablePanel', () => {
    it('should hide other panels when opening', () => {
      const store = createStore()
      store.getState().setShowDebugAndPreviewPanel(true)
      store.getState().setShowChatVariablePanel(true)

      store.getState().setShowGlobalVariablePanel(true)

      const state = store.getState()
      expect(state.showGlobalVariablePanel).toBe(true)
      expect(state.showDebugAndPreviewPanel).toBe(false)
      expect(state.showChatVariablePanel).toBe(false)
      expect(state.showEnvPanel).toBe(false)
    })

    it('should only close itself when setting false', () => {
      const store = createStore()
      store.getState().setShowGlobalVariablePanel(true)
      store.getState().setShowGlobalVariablePanel(false)

      expect(store.getState().showGlobalVariablePanel).toBe(false)
    })
  })

  describe('setConversationVariables', () => {
    it('should update conversationVariables', () => {
      const store = createStore()
      const vars: ConversationVariable[] = [{ id: 'cv1', name: 'history', value: [], value_type: ChatVarType.String, description: '' }]
      store.getState().setConversationVariables(vars)
      expect(store.getState().conversationVariables).toEqual(vars)
    })
  })
})
