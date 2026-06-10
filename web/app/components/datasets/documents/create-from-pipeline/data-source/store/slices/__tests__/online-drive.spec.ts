import type { OnlineDriveSliceShape } from '../online-drive'
import type { OnlineDriveFile } from '@/models/pipeline'
import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand'
import { createOnlineDriveSlice } from '../online-drive'

const createTestStore = () => createStore<OnlineDriveSliceShape>((...args) => createOnlineDriveSlice(...args))

describe('createOnlineDriveSlice', () => {
  it('should initialize with default values', () => {
    const state = createTestStore().getState()

    expect(state.breadcrumbs).toEqual([])
    expect(state.prefix).toEqual([])
    expect(state.keywords).toBe('')
    expect(state.selectedFileIds).toEqual([])
    expect(state.onlineDriveFileList).toEqual([])
    expect(state.bucket).toBe('')
    expect(state.nextPageParameters).toEqual({})
    expect(state.isTruncated.current).toBe(false)
    expect(state.previewOnlineDriveFileRef.current).toBeUndefined()
    expect(state.hasBucket).toBe(false)
  })

  it('should set breadcrumbs', () => {
    const store = createTestStore()
    store.getState().setBreadcrumbs(['root', 'folder'])
    expect(store.getState().breadcrumbs).toEqual(['root', 'folder'])
  })

  it('should set prefix', () => {
    const store = createTestStore()
    store.getState().setPrefix(['a', 'b'])
    expect(store.getState().prefix).toEqual(['a', 'b'])
  })

  it('should set keywords', () => {
    const store = createTestStore()
    store.getState().setKeywords('search term')
    expect(store.getState().keywords).toBe('search term')
  })

  it('should set selected file ids and update preview ref', () => {
    const store = createTestStore()
    const files = [
      { id: 'file-1', name: 'a.pdf', type: 'file' },
      { id: 'file-2', name: 'b.pdf', type: 'file' },
    ] as unknown as OnlineDriveFile[]
    store.getState().setOnlineDriveFileList(files)
    store.getState().setSelectedFileIds(['file-1'])

    expect(store.getState().selectedFileIds).toEqual(['file-1'])
    expect(store.getState().previewOnlineDriveFileRef.current).toEqual(files[0])
  })

  it('should set preview ref to undefined when selected id not found', () => {
    const store = createTestStore()
    store.getState().setSelectedFileIds(['non-existent'])
    expect(store.getState().previewOnlineDriveFileRef.current).toBeUndefined()
  })

  it('should set bucket', () => {
    const store = createTestStore()
    store.getState().setBucket('my-bucket')
    expect(store.getState().bucket).toBe('my-bucket')
  })

  it('should set next page parameters', () => {
    const store = createTestStore()
    store.getState().setNextPageParameters({ cursor: 'abc' })
    expect(store.getState().nextPageParameters).toEqual({ cursor: 'abc' })
  })

  it('should set hasBucket', () => {
    const store = createTestStore()
    store.getState().setHasBucket(true)
    expect(store.getState().hasBucket).toBe(true)
  })
})
