import type { LocalFileSliceShape } from '../local-file'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand'
import { createLocalFileSlice } from '../local-file'

const createTestStore = () => createStore<LocalFileSliceShape>((...args) => createLocalFileSlice(...args))

describe('createLocalFileSlice', () => {
  it('should initialize with default values', () => {
    const state = createTestStore().getState()

    expect(state.localFileList).toEqual([])
    expect(state.currentLocalFile).toBeUndefined()
    expect(state.previewLocalFileRef.current).toBeUndefined()
  })

  it('should set local file list and update preview ref to first file', () => {
    const store = createTestStore()
    const files = [
      { file: { id: 'f1', name: 'a.pdf' } },
      { file: { id: 'f2', name: 'b.pdf' } },
    ] as unknown as FileItem[]

    store.getState().setLocalFileList(files)
    expect(store.getState().localFileList).toEqual(files)
    expect(store.getState().previewLocalFileRef.current).toEqual({ id: 'f1', name: 'a.pdf' })
  })

  it('should set preview ref to undefined for empty file list', () => {
    const store = createTestStore()
    store.getState().setLocalFileList([])
    expect(store.getState().previewLocalFileRef.current).toBeUndefined()
  })

  it('should set current local file', () => {
    const store = createTestStore()
    const file = { id: 'f1', name: 'test.pdf' } as unknown as File
    store.getState().setCurrentLocalFile(file)
    expect(store.getState().currentLocalFile).toEqual(file)
  })

  it('should clear current local file with undefined', () => {
    const store = createTestStore()
    store.getState().setCurrentLocalFile({ id: 'f1' } as unknown as File)
    store.getState().setCurrentLocalFile(undefined)
    expect(store.getState().currentLocalFile).toBeUndefined()
  })
})
