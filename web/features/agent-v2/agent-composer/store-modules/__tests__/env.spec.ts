import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import { defaultAgentSoulConfigFormState } from '../../form-state'
import { agentComposerDraftAtom } from '../../store'
import {
  addEnvVariableAtom,
  importEnvVariablesAtom,
  removeEnvVariableAtom,
  setEnvVariableKeyAtom,
  setEnvVariableValueAtom,
} from '../env'

const starterVariable = {
  id: 'starter',
  key: '',
  value: '',
  scope: 'plain',
} as const

describe('agent composer env store', () => {
  it('should promote the starter variable when editing an empty env list', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, defaultAgentSoulConfigFormState)

    store.set(setEnvVariableKeyAtom, {
      id: starterVariable.id,
      key: 'API_KEY',
      starterVariable,
    })
    store.set(setEnvVariableValueAtom, {
      id: starterVariable.id,
      starterVariable,
      value: 'secret-value',
    })

    expect(store.get(agentComposerDraftAtom).envVariables).toEqual([
      {
        id: 'starter',
        key: 'API_KEY',
        value: 'secret-value',
        scope: 'plain',
      },
    ])
  })

  it('should add, import, and remove variables from the latest draft state', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, defaultAgentSoulConfigFormState)

    store.set(addEnvVariableAtom, {
      starterVariable,
      variable: {
        id: 'env-1',
        key: 'FIRST_KEY',
        value: '',
        scope: 'plain',
      },
    })
    store.set(importEnvVariablesAtom, [
      {
        id: 'env-2',
        key: 'SECOND_KEY',
        value: 'enabled',
        scope: 'plain',
      },
    ])
    store.set(removeEnvVariableAtom, 'starter')

    expect(store.get(agentComposerDraftAtom).envVariables).toEqual([
      {
        id: 'env-1',
        key: 'FIRST_KEY',
        value: '',
        scope: 'plain',
      },
      {
        id: 'env-2',
        key: 'SECOND_KEY',
        value: 'enabled',
        scope: 'plain',
      },
    ])
  })
})
