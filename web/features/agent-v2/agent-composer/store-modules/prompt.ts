import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerPromptAtom = atom(
  (get) => get(agentComposerDraftAtom).prompt,
  (get, set, promptUpdate: DraftFieldUpdate<string>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      prompt: resolveDraftFieldUpdate(draft.prompt, promptUpdate),
    })
  },
)
