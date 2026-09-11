import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { promptHasHumanMention } from '../human-contacts'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerPromptAtom = atom(
  (get) => get(agentComposerDraftAtom).prompt,
  (get, set, promptUpdate: DraftFieldUpdate<string>) => {
    const draft = get(agentComposerDraftAtom)
    const prompt = resolveDraftFieldUpdate(draft.prompt, promptUpdate)

    set(agentComposerDraftAtom, {
      ...draft,
      prompt,
      humanContacts: draft.humanContacts.filter((contact) => promptHasHumanMention(prompt, contact)),
    })
  },
)
