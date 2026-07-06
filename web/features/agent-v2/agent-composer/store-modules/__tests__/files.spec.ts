import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import { defaultAgentSoulConfigFormState } from '../../form-state'
import { agentComposerDraftAtom } from '../../store'
import {
  clearAgentConfigNoteAtom,
  removeAgentFileAtom,
  upsertAgentFileAtom,
} from '../files'

describe('agent composer files store', () => {
  it('should upsert and remove files from the latest draft state', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, {
      ...defaultAgentSoulConfigFormState,
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

  it('should clear config note through the file action surface', () => {
    const store = createStore()
    store.set(agentComposerDraftAtom, {
      ...defaultAgentSoulConfigFormState,
      configNote: 'Build note',
    })

    store.set(clearAgentConfigNoteAtom)

    expect(store.get(agentComposerDraftAtom).configNote).toBe('')
  })
})
