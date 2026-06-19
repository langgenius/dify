import type { EnvVariable } from '../form-state'
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
