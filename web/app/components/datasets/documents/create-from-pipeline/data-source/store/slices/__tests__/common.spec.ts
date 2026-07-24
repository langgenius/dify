import type { CommonShape } from '../common'
import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand'
import { createCommonSlice } from '../common'

const createTestStore = () => createStore<CommonShape>((...args) => createCommonSlice(...args))

describe('createCommonSlice', () => {
  it('should initialize with default values', () => {
    const state = createTestStore().getState()

    expect(state.currentCredentialId).toBe('')
    expect(state.currentNodeIdRef.current).toBe('')
    expect(state.currentCredentialIdRef.current).toBe('')
  })

  it('should update currentCredentialId', () => {
    const store = createTestStore()
    store.getState().setCurrentCredentialId('cred-123')
    expect(store.getState().currentCredentialId).toBe('cred-123')
  })

  it('should update currentCredentialId multiple times', () => {
    const store = createTestStore()
    store.getState().setCurrentCredentialId('cred-1')
    store.getState().setCurrentCredentialId('cred-2')
    expect(store.getState().currentCredentialId).toBe('cred-2')
  })
})
