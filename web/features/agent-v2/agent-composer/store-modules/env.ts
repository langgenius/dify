import type { EnvScope, EnvVariable } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerEnvVariablesAtom = atom(
  get => get(agentComposerDraftAtom).envVariables,
  (get, set, envVariablesUpdate: DraftFieldUpdate<EnvVariable[]>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      envVariables: resolveDraftFieldUpdate(draft.envVariables, envVariablesUpdate),
    })
  },
)

const updateEnvVariable = (
  envVariables: EnvVariable[],
  starterVariable: EnvVariable,
  id: string,
  updater: (variable: EnvVariable) => EnvVariable,
) => {
  const existingVariable = envVariables.find(variable => variable.id === id)

  if (existingVariable) {
    return envVariables.map(variable => (
      variable.id === id ? updater(variable) : variable
    ))
  }

  if (id === starterVariable.id)
    return [updater(starterVariable)]

  return envVariables
}

export const setEnvVariableKeyAtom = atom(null, (_get, set, {
  id,
  key,
  starterVariable,
}: {
  id: string
  key: string
  starterVariable: EnvVariable
}) => {
  set(agentComposerEnvVariablesAtom, envVariables => updateEnvVariable(
    envVariables,
    starterVariable,
    id,
    variable => ({ ...variable, key }),
  ))
})

export const setEnvVariableScopeAtom = atom(null, (_get, set, {
  id,
  scope,
  starterVariable,
}: {
  id: string
  scope: EnvScope
  starterVariable: EnvVariable
}) => {
  set(agentComposerEnvVariablesAtom, envVariables => updateEnvVariable(
    envVariables,
    starterVariable,
    id,
    variable => ({ ...variable, scope }),
  ))
})

export const setEnvVariableValueAtom = atom(null, (_get, set, {
  id,
  starterVariable,
  value,
}: {
  id: string
  starterVariable: EnvVariable
  value: string
}) => {
  set(agentComposerEnvVariablesAtom, envVariables => updateEnvVariable(
    envVariables,
    starterVariable,
    id,
    variable => ({ ...variable, value }),
  ))
})

export const addEnvVariableAtom = atom(null, (_get, set, {
  starterVariable,
  variable,
}: {
  starterVariable: EnvVariable
  variable: EnvVariable
}) => {
  set(agentComposerEnvVariablesAtom, envVariables => [
    ...(envVariables.length > 0 ? envVariables : [starterVariable]),
    variable,
  ])
})

export const importEnvVariablesAtom = atom(null, (_get, set, variables: EnvVariable[]) => {
  set(agentComposerEnvVariablesAtom, envVariables => [...envVariables, ...variables])
})

export const removeEnvVariableAtom = atom(null, (_get, set, id: string) => {
  set(agentComposerEnvVariablesAtom, envVariables => envVariables.filter(variable => variable.id !== id))
})
