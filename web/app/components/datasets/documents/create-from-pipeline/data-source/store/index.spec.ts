import type { FileItem } from '@/models/datasets'
import { describe, expect, it } from 'vitest'
import { createDataSourceStore } from './'

describe('createDataSourceStore', () => {
  it('should create a store with all slices combined', () => {
    const store = createDataSourceStore()
    const state = store.getState()

    // Common slice
    expect(state.currentCredentialId).toBe('')
    expect(typeof state.setCurrentCredentialId).toBe('function')

    // LocalFile slice
    expect(state.localFileList).toEqual([])
    expect(typeof state.setLocalFileList).toBe('function')

    // OnlineDocument slice
    expect(state.documentsData).toEqual([])
    expect(typeof state.setDocumentsData).toBe('function')

    // WebsiteCrawl slice
    expect(state.websitePages).toEqual([])
    expect(typeof state.setWebsitePages).toBe('function')

    // OnlineDrive slice
    expect(state.breadcrumbs).toEqual([])
    expect(typeof state.setBreadcrumbs).toBe('function')
  })

  it('should allow cross-slice state updates', () => {
    const store = createDataSourceStore()

    store.getState().setCurrentCredentialId('cred-1')
    store.getState().setLocalFileList([{ file: { id: 'f1' } }] as unknown as FileItem[])

    expect(store.getState().currentCredentialId).toBe('cred-1')
    expect(store.getState().localFileList).toHaveLength(1)
  })

  it('should create independent store instances', () => {
    const store1 = createDataSourceStore()
    const store2 = createDataSourceStore()

    store1.getState().setCurrentCredentialId('cred-1')
    expect(store2.getState().currentCredentialId).toBe('')
  })
})
