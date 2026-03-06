import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

function createStore() {
  return createTestWorkflowStore()
}

describe('Env Variable Slice', () => {
  describe('setShowEnvPanel', () => {
    it('should hide other panels when opening', () => {
      const store = createStore()
      store.getState().setShowDebugAndPreviewPanel(true)
      store.getState().setShowChatVariablePanel(true)

      store.getState().setShowEnvPanel(true)

      const state = store.getState()
      expect(state.showEnvPanel).toBe(true)
      expect(state.showDebugAndPreviewPanel).toBe(false)
      expect(state.showChatVariablePanel).toBe(false)
      expect(state.showGlobalVariablePanel).toBe(false)
    })

    it('should only close itself when setting false', () => {
      const store = createStore()
      store.getState().setShowEnvPanel(true)

      store.getState().setShowEnvPanel(false)

      expect(store.getState().showEnvPanel).toBe(false)
    })
  })

  describe('setEnvironmentVariables', () => {
    it('should update environmentVariables', () => {
      const store = createStore()
      const vars: EnvironmentVariable[] = [{ id: 'v1', name: 'API_KEY', value: 'secret', value_type: 'string', description: '' }]
      store.getState().setEnvironmentVariables(vars)
      expect(store.getState().environmentVariables).toEqual(vars)
    })
  })

  describe('setEnvSecrets', () => {
    it('should update envSecrets', () => {
      const store = createStore()
      store.getState().setEnvSecrets({ API_KEY: '***' })
      expect(store.getState().envSecrets).toEqual({ API_KEY: '***' })
    })
  })

  describe('Sequential Panel Switching', () => {
    it('should correctly switch between exclusive panels', () => {
      const store = createStore()

      store.getState().setShowChatVariablePanel(true)
      expect(store.getState().showChatVariablePanel).toBe(true)

      store.getState().setShowEnvPanel(true)
      expect(store.getState().showEnvPanel).toBe(true)
      expect(store.getState().showChatVariablePanel).toBe(false)

      store.getState().setShowGlobalVariablePanel(true)
      expect(store.getState().showGlobalVariablePanel).toBe(true)
      expect(store.getState().showEnvPanel).toBe(false)
    })
  })
})
