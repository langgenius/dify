import type { AgentSoulConfigFormState } from './form-state'
import isEqual from 'fast-deep-equal'
import { atom } from 'jotai'
import { defaultAgentSoulConfigFormState } from './form-state'

export const agentComposerSavedDraftAtom = atom<AgentSoulConfigFormState | undefined>(
  defaultAgentSoulConfigFormState,
)
export const agentComposerDraftAtom = atom<AgentSoulConfigFormState>(
  defaultAgentSoulConfigFormState,
)

export const rebaseAgentComposerDraftAtom = atom(
  null,
  (
    _get,
    set,
    {
      draft,
    }: {
      draft: AgentSoulConfigFormState
    },
  ) => {
    set(agentComposerDraftAtom, draft)
    set(agentComposerSavedDraftAtom, draft)
  },
)

export const isAgentComposerDirtyAtom = atom((get) => {
  const savedDraft = get(agentComposerSavedDraftAtom)
  const draft = get(agentComposerDraftAtom)

  return !isEqual(draft, savedDraft ?? defaultAgentSoulConfigFormState)
})
