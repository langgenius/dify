import type { SkillEditorSliceShape } from './types'
import { createStore } from 'zustand/vanilla'
import { START_TAB_ID } from '@/app/components/workflow/skill/constants'
import { createSkillEditorSlice } from './index'

const createSkillEditorStore = () => {
  return createStore<SkillEditorSliceShape>()((...args) => ({
    ...createSkillEditorSlice(...args),
  }))
}

describe('tab slice editor auto focus intent', () => {
  it('should set editorAutoFocusFileId when opening a tab with autoFocusEditor', () => {
    const store = createSkillEditorStore()

    store.getState().openTab('file-1', { pinned: true, autoFocusEditor: true })

    expect(store.getState().activeTabId).toBe('file-1')
    expect(store.getState().openTabIds).toEqual(['file-1'])
    expect(store.getState().editorAutoFocusFileId).toBe('file-1')
  })

  it('should preserve existing editor auto focus intent when opening another tab without auto focus', () => {
    const store = createSkillEditorStore()

    store.getState().openTab('file-1', { pinned: true, autoFocusEditor: true })
    store.getState().openTab('file-2', { pinned: true })

    expect(store.getState().activeTabId).toBe('file-2')
    expect(store.getState().openTabIds).toEqual(['file-1', 'file-2'])
    expect(store.getState().editorAutoFocusFileId).toBe('file-1')
  })

  it('should clear editor auto focus intent only for matching file id', () => {
    const store = createSkillEditorStore()

    store.getState().openTab('file-1', { pinned: true, autoFocusEditor: true })
    store.getState().clearEditorAutoFocus('file-2')
    expect(store.getState().editorAutoFocusFileId).toBe('file-1')

    store.getState().clearEditorAutoFocus('file-1')
    expect(store.getState().editorAutoFocusFileId).toBeNull()
  })

  it('should clear editor auto focus intent when the focused file tab is closed', () => {
    const store = createSkillEditorStore()

    store.getState().openTab('file-1', { pinned: true, autoFocusEditor: true })
    store.getState().closeTab('file-1')

    expect(store.getState().activeTabId).toBe(START_TAB_ID)
    expect(store.getState().editorAutoFocusFileId).toBeNull()
  })
})
