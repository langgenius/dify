import type { AgentHumanContactConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { getAgentHumanContactId, removeAgentHumanMentions } from '../human-contacts'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerHumanContactsAtom = atom(
  (get) => get(agentComposerDraftAtom).humanContacts,
  (get, set, contactsUpdate: DraftFieldUpdate<AgentHumanContactConfig[]>) => {
    const draft = get(agentComposerDraftAtom)
    const humanContacts = resolveDraftFieldUpdate(draft.humanContacts, contactsUpdate)

    set(agentComposerDraftAtom, {
      ...draft,
      humanContacts,
    })
  },
)

export const addHumanContactAtom = atom(
  null,
  (get, set, contact: AgentHumanContactConfig) => {
    const draft = get(agentComposerDraftAtom)
    const contactId = getAgentHumanContactId(contact)
    if (!contactId) return
    if (draft.humanContacts.some((current) => getAgentHumanContactId(current) === contactId))
      return

    set(agentComposerDraftAtom, {
      ...draft,
      humanContacts: [...draft.humanContacts, contact],
    })
  },
)

export const removeHumanContactAtom = atom(null, (get, set, contactId: string) => {
  const draft = get(agentComposerDraftAtom)
  const contact = draft.humanContacts.find(
    (current) => getAgentHumanContactId(current) === contactId,
  )
  if (!contact) return

  set(agentComposerDraftAtom, {
    ...draft,
    humanContacts: draft.humanContacts.filter(
      (current) => getAgentHumanContactId(current) !== contactId,
    ),
    prompt: removeAgentHumanMentions(draft.prompt, contact),
  })
})
