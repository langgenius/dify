import type { AgentKnowledgeRetrievalItem } from '../../agent-detail/configure/components/data'
import type { DraftFieldUpdate } from './utils'
import { atom, useAtom } from 'jotai'
import { syncKnowledgeReferenceLabels } from '../reference-labels'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerKnowledgeRetrievalsAtom = atom(
  get => get(agentComposerDraftAtom).knowledgeRetrievals,
  (get, set, knowledgeRetrievalsUpdate: DraftFieldUpdate<AgentKnowledgeRetrievalItem[]>) => {
    const draft = get(agentComposerDraftAtom)
    const knowledgeRetrievals = resolveDraftFieldUpdate(draft.knowledgeRetrievals, knowledgeRetrievalsUpdate)

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

export function useKnowledgeRetrievals() {
  const [knowledgeRetrievals, setKnowledgeRetrievals] = useAtom(agentComposerKnowledgeRetrievalsAtom)
  return [knowledgeRetrievals, setKnowledgeRetrievals] as const
}
