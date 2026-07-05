import type { AgentComposerModel } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerModelAtom = atom(
  get => get(agentComposerDraftAtom).model,
  (get, set, modelUpdate: DraftFieldUpdate<AgentComposerModel | undefined>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      model: resolveDraftFieldUpdate(draft.model, modelUpdate),
    })
  },
)
