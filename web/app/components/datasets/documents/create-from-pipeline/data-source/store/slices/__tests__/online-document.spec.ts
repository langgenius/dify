import type { OnlineDocumentSliceShape } from '../online-document'
import type { DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand'
import { createOnlineDocumentSlice } from '../online-document'

const createTestStore = () => createStore<OnlineDocumentSliceShape>((...args) => createOnlineDocumentSlice(...args))

describe('createOnlineDocumentSlice', () => {
  it('should initialize with default values', () => {
    const state = createTestStore().getState()

    expect(state.documentsData).toEqual([])
    expect(state.searchValue).toBe('')
    expect(state.onlineDocuments).toEqual([])
    expect(state.currentDocument).toBeUndefined()
    expect(state.selectedPagesId).toEqual(new Set())
    expect(state.previewOnlineDocumentRef.current).toBeUndefined()
  })

  it('should set documents data', () => {
    const store = createTestStore()
    const data = [{ workspace_id: 'w1', pages: [] }] as unknown as DataSourceNotionWorkspace[]
    store.getState().setDocumentsData(data)
    expect(store.getState().documentsData).toEqual(data)
  })

  it('should set search value', () => {
    const store = createTestStore()
    store.getState().setSearchValue('hello')
    expect(store.getState().searchValue).toBe('hello')
  })

  it('should set online documents and update preview ref', () => {
    const store = createTestStore()
    const pages = [{ page_id: 'p1' }, { page_id: 'p2' }] as unknown as NotionPage[]
    store.getState().setOnlineDocuments(pages)
    expect(store.getState().onlineDocuments).toEqual(pages)
    expect(store.getState().previewOnlineDocumentRef.current).toEqual({ page_id: 'p1' })
  })

  it('should set current document', () => {
    const store = createTestStore()
    const doc = { page_id: 'p1' } as unknown as NotionPage
    store.getState().setCurrentDocument(doc)
    expect(store.getState().currentDocument).toEqual(doc)
  })

  it('should set selected pages id', () => {
    const store = createTestStore()
    const ids = new Set(['p1', 'p2'])
    store.getState().setSelectedPagesId(ids)
    expect(store.getState().selectedPagesId).toEqual(ids)
  })
})
