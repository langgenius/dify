import type { VersionHistory } from '@/types/workflow'
import { createStore } from 'zustand/vanilla'
import { createVersionSlice } from '../version-slice'

describe('createVersionSlice', () => {
  it('stores timestamps in milliseconds and tracks restore state', () => {
    const store = createStore(createVersionSlice)
    const currentVersion: VersionHistory = {
      id: 'version-2',
      graph: {
        nodes: [],
        edges: [],
      },
      created_at: 2,
      created_by: {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
      },
      hash: 'hash-version-2',
      updated_at: 2,
      updated_by: {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
      },
      tool_published: false,
      version: '2',
      marked_name: '',
      marked_comment: '',
    }

    store.getState().setDraftUpdatedAt(10)
    store.getState().setPublishedAt(15)
    store.getState().setCurrentVersion(currentVersion)
    store.getState().setIsRestoring(true)

    expect(store.getState().draftUpdatedAt).toBe(10_000)
    expect(store.getState().publishedAt).toBe(15_000)
    expect(store.getState().currentVersion).toBe(currentVersion)
    expect(store.getState().isRestoring).toBe(true)
  })
})
