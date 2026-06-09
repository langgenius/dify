import type { EnvVariableSliceShape } from '../env-variable-slice'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { createStore } from 'zustand/vanilla'
import { createEnvVariableSlice } from '../env-variable-slice'

type EnvPanelState = EnvVariableSliceShape & {
  showDebugAndPreviewPanel?: boolean
  showChatVariablePanel?: boolean
  showGlobalVariablePanel?: boolean
}

describe('createEnvVariableSlice', () => {
  it('opens the env panel while clearing other overlay states', () => {
    const store = createStore(createEnvVariableSlice)

    store.getState().setShowEnvPanel(true)

    const state = store.getState() as EnvPanelState
    expect(state).toMatchObject({
      showEnvPanel: true,
      showDebugAndPreviewPanel: false,
      showChatVariablePanel: false,
      showGlobalVariablePanel: false,
    })

    store.getState().setShowEnvPanel(false)

    expect(store.getState().showEnvPanel).toBe(false)
  })

  it('stores environment variables and secrets', () => {
    const store = createStore(createEnvVariableSlice)
    const environmentVariables: EnvironmentVariable[] = [
      {
        id: 'env-1',
        name: 'API_KEY',
        value: 'test',
        value_type: 'secret',
        description: 'secret env',
      },
    ]

    store.getState().setEnvironmentVariables(environmentVariables)
    store.getState().setEnvSecrets({ API_KEY: 'masked' })

    expect(store.getState().environmentVariables).toEqual(environmentVariables)
    expect(store.getState().envSecrets).toEqual({ API_KEY: 'masked' })
  })
})
