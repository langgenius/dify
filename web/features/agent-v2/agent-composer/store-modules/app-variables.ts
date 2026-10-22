import type { AppVariable, AppVariableType } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerAppVariablesAtom = atom(
  (get) => get(agentComposerDraftAtom).appVariables,
  (get, set, appVariablesUpdate: DraftFieldUpdate<AppVariable[]>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      appVariables: resolveDraftFieldUpdate(draft.appVariables, appVariablesUpdate),
    })
  },
)

const updateAppVariable = (
  appVariables: AppVariable[],
  starterVariable: AppVariable,
  id: string,
  updater: (variable: AppVariable) => AppVariable,
) => {
  const existingVariable = appVariables.find((variable) => variable.id === id)

  if (existingVariable) {
    return appVariables.map((variable) => (variable.id === id ? updater(variable) : variable))
  }

  if (id === starterVariable.id) return [updater(starterVariable)]

  return appVariables
}

export const setAppVariableNameAtom = atom(
  null,
  (
    _get,
    set,
    {
      id,
      name,
      starterVariable,
    }: {
      id: string
      name: string
      starterVariable: AppVariable
    },
  ) => {
    set(agentComposerAppVariablesAtom, (appVariables) =>
      updateAppVariable(appVariables, starterVariable, id, (variable) => ({ ...variable, name })),
    )
  },
)

export const setAppVariableTypeAtom = atom(
  null,
  (
    _get,
    set,
    {
      id,
      starterVariable,
      type,
    }: {
      id: string
      starterVariable: AppVariable
      type: AppVariableType
    },
  ) => {
    set(agentComposerAppVariablesAtom, (appVariables) =>
      updateAppVariable(appVariables, starterVariable, id, (variable) => ({
        ...variable,
        type,
        options: type === 'select' ? (variable.options ?? []) : undefined,
      })),
    )
  },
)

export const setAppVariableRequiredAtom = atom(
  null,
  (
    _get,
    set,
    {
      id,
      required,
      starterVariable,
    }: {
      id: string
      required: boolean
      starterVariable: AppVariable
    },
  ) => {
    set(agentComposerAppVariablesAtom, (appVariables) =>
      updateAppVariable(appVariables, starterVariable, id, (variable) => ({
        ...variable,
        required,
        hide: required ? false : variable.hide,
      })),
    )
  },
)

export const setAppVariableHideAtom = atom(
  null,
  (
    _get,
    set,
    {
      hide,
      id,
      starterVariable,
    }: {
      hide: boolean
      id: string
      starterVariable: AppVariable
    },
  ) => {
    set(agentComposerAppVariablesAtom, (appVariables) =>
      updateAppVariable(appVariables, starterVariable, id, (variable) => ({
        ...variable,
        hide,
        required: hide ? false : variable.required,
      })),
    )
  },
)

export const setAppVariableDefaultAtom = atom(
  null,
  (
    _get,
    set,
    {
      defaultValue,
      id,
      starterVariable,
    }: {
      defaultValue: string
      id: string
      starterVariable: AppVariable
    },
  ) => {
    set(agentComposerAppVariablesAtom, (appVariables) =>
      updateAppVariable(appVariables, starterVariable, id, (variable) => ({
        ...variable,
        default: defaultValue,
      })),
    )
  },
)

export const setAppVariableOptionsAtom = atom(
  null,
  (
    _get,
    set,
    {
      id,
      options,
      starterVariable,
    }: {
      id: string
      options: string[]
      starterVariable: AppVariable
    },
  ) => {
    set(agentComposerAppVariablesAtom, (appVariables) =>
      updateAppVariable(appVariables, starterVariable, id, (variable) => ({
        ...variable,
        options,
      })),
    )
  },
)

export const addAppVariableAtom = atom(
  null,
  (
    _get,
    set,
    {
      starterVariable,
      variable,
    }: {
      starterVariable: AppVariable
      variable: AppVariable
    },
  ) => {
    set(agentComposerAppVariablesAtom, (appVariables) => [
      ...(appVariables.length > 0 ? appVariables : [starterVariable]),
      variable,
    ])
  },
)

export const removeAppVariableAtom = atom(null, (_get, set, id: string) => {
  set(agentComposerAppVariablesAtom, (appVariables) =>
    appVariables.filter((variable) => variable.id !== id),
  )
})
