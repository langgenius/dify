import type { AgentKnowledgeRetrievalItem } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { syncKnowledgeReferenceLabels } from '../reference-labels'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerKnowledgeRetrievalsAtom = atom(
  (get) => get(agentComposerDraftAtom).knowledgeRetrievals,
  (get, set, knowledgeRetrievalsUpdate: DraftFieldUpdate<AgentKnowledgeRetrievalItem[]>) => {
    const draft = get(agentComposerDraftAtom)
    const knowledgeRetrievals = resolveDraftFieldUpdate(
      draft.knowledgeRetrievals,
      knowledgeRetrievalsUpdate,
    )

    set(agentComposerDraftAtom, {
      ...draft,
      prompt: syncKnowledgeReferenceLabels({
        prompt: draft.prompt,
        currentRetrievals: draft.knowledgeRetrievals,
        nextRetrievals: knowledgeRetrievals,
      }),
      knowledgeRetrievals,
    })
  },
)

/** Agent Knowledge Base bindings stay saved but hidden while KnowledgeFS is unavailable. */
export const getVisibleKnowledgeRetrievals = (
  retrievals: AgentKnowledgeRetrievalItem[],
  knowledgeFsEnabled: boolean,
) => (knowledgeFsEnabled ? retrievals : retrievals.filter((item) => !item.controlSpaceId))

export const removeKnowledgeRetrievalAtom = atom(null, (_get, set, retrievalId: string) => {
  set(agentComposerKnowledgeRetrievalsAtom, (retrievals) =>
    retrievals.filter((retrieval) => retrieval.id !== retrievalId),
  )
})
