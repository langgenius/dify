import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import { defaultAgentSoulConfigFormState } from '../../form-state'
import { agentComposerDraftAtom } from '../../store'
import {
  addKnowledgeRetrievalAtom,
  removeKnowledgeRetrievalAtom,
  updateKnowledgeRetrievalAtom,
} from '../knowledge'

describe('agent composer knowledge store', () => {
  it('should apply retrieval list actions against the latest draft state', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, {
      ...defaultAgentSoulConfigFormState,
      knowledgeRetrievals: [
        {
          id: 'retrieval-1',
          name: 'Docs Search',
        },
      ],
    })

    store.set(addKnowledgeRetrievalAtom, {
      id: 'retrieval-2',
      name: 'Release Search',
    })
    store.set(updateKnowledgeRetrievalAtom, {
      id: 'retrieval-1',
      name: 'Updated Docs Search',
    })
    store.set(removeKnowledgeRetrievalAtom, 'retrieval-2')

    expect(store.get(agentComposerDraftAtom).knowledgeRetrievals).toEqual([
      {
        id: 'retrieval-1',
        name: 'Updated Docs Search',
      },
    ])
  })
})
