import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import { defaultAgentSoulConfigFormState } from '../../form-state'
import { agentComposerDraftAtom } from '../../store'
import {
  removeAgentSkillAtom,
  upsertAgentSkillAtom,
} from '../skills'

describe('agent composer skills store', () => {
  it('should upsert and remove skills from the latest draft state', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, {
      ...defaultAgentSoulConfigFormState,
      skills: [
        {
          id: 'Tender Analyzer',
          name: 'Tender Analyzer',
          description: 'Extracts tender requirements.',
          fileId: 'tool-file-1',
        },
      ],
    })

    store.set(upsertAgentSkillAtom, {
      id: 'Tender Analyzer',
      name: 'Tender Analyzer',
      description: 'Updated skill.',
      fileId: 'tool-file-1',
    })
    store.set(upsertAgentSkillAtom, {
      id: 'Invoice Helper',
      name: 'Invoice Helper',
      fileId: 'tool-file-2',
    })
    store.set(removeAgentSkillAtom, 'Tender Analyzer')

    expect(store.get(agentComposerDraftAtom).skills).toEqual([
      {
        id: 'Invoice Helper',
        name: 'Invoice Helper',
        fileId: 'tool-file-2',
      },
    ])
  })
})
