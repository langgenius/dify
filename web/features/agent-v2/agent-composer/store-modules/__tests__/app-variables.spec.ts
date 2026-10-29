import { createStore } from 'jotai'
import { describe, expect, it } from 'vite-plus/test'
import { defaultAgentSoulConfigFormState } from '../../form-state'
import { agentComposerDraftAtom } from '../../store'
import {
  addAppVariableAtom,
  removeAppVariableAtom,
  setAppVariableHideAtom,
  setAppVariableNameAtom,
  setAppVariableRequiredAtom,
} from '../app-variables'

const starterVariable = {
  id: 'starter',
  name: '',
  type: 'text-input',
  required: false,
  default: '',
  hide: false,
} as const

describe('agent composer app variables store', () => {
  it('should promote the starter variable when editing an empty list', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, defaultAgentSoulConfigFormState)

    store.set(setAppVariableNameAtom, {
      id: starterVariable.id,
      name: 'expense_id',
      starterVariable,
    })

    expect(store.get(agentComposerDraftAtom).appVariables).toEqual([
      {
        id: 'starter',
        name: 'expense_id',
        type: 'text-input',
        required: false,
        default: '',
        hide: false,
      },
    ])
  })

  it('should keep required and hidden mutually exclusive', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, {
      ...defaultAgentSoulConfigFormState,
      appVariables: [
        {
          id: 'var-1',
          name: 'topic',
          type: 'text-input',
          required: false,
          default: '',
          hide: false,
        },
      ],
    })

    store.set(setAppVariableRequiredAtom, {
      id: 'var-1',
      required: true,
      starterVariable,
    })
    expect(store.get(agentComposerDraftAtom).appVariables[0]?.hide).toBe(false)

    store.set(setAppVariableHideAtom, {
      id: 'var-1',
      hide: true,
      starterVariable,
    })
    expect(store.get(agentComposerDraftAtom).appVariables[0]).toMatchObject({
      required: false,
      hide: true,
    })
  })

  it('should add and remove variables from the latest draft state', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, defaultAgentSoulConfigFormState)

    store.set(addAppVariableAtom, {
      starterVariable,
      variable: {
        id: 'var-1',
        name: 'user_id',
        type: 'text-input',
        required: false,
        default: '',
        hide: true,
      },
    })
    store.set(removeAppVariableAtom, 'starter')

    expect(store.get(agentComposerDraftAtom).appVariables).toEqual([
      {
        id: 'var-1',
        name: 'user_id',
        type: 'text-input',
        required: false,
        default: '',
        hide: true,
      },
    ])
  })
})
