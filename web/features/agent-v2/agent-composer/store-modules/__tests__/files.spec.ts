import { createStore } from 'jotai'
import { describe, expect, it } from 'vite-plus/test'
import { defaultAgentSoulConfigFormState } from '../../form-state'
import { agentComposerDraftAtom } from '../../store'
import { removeAgentFileAtom, upsertAgentFileAtom } from '../files'

describe('agent composer files store', () => {
  it('should upsert and remove files from the latest draft state', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Use [§file:diagram.png:diagram.png§].',
      files: [
        {
          id: 'folder',
          icon: 'folder',
          name: 'Folder',
          children: [
            {
              id: 'brief.md',
              icon: 'markdown',
              name: 'brief.md',
            },
          ],
        },
        {
          id: 'diagram.png',
          icon: 'image',
          name: 'diagram.png',
        },
      ],
    })

    store.set(upsertAgentFileAtom, {
      id: 'diagram.png',
      icon: 'image',
      name: 'updated-diagram.png',
    })
    expect(store.get(agentComposerDraftAtom).prompt).toBe(
      'Use [§file:diagram.png:updated-diagram.png§].',
    )
    store.set(removeAgentFileAtom, 'brief.md')

    expect(store.get(agentComposerDraftAtom).files).toEqual([
      {
        id: 'folder',
        icon: 'folder',
        name: 'Folder',
        children: [],
      },
      {
        id: 'diagram.png',
        icon: 'image',
        name: 'updated-diagram.png',
      },
    ])
  })
})
