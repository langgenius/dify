import type { FileItem } from '@/models/datasets'
import { render, renderHook } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { createDataSourceStore, useDataSourceStore, useDataSourceStoreWithSelector } from '../'
import DataSourceProvider from '../provider'

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

describe('useDataSourceStoreWithSelector', () => {
  it('should throw when used outside provider', () => {
    expect(() => {
      renderHook(() => useDataSourceStoreWithSelector(s => s.currentCredentialId))
    }).toThrow('Missing DataSourceContext.Provider in the tree')
  })

  it('should return selected state when used inside provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DataSourceProvider, null, children)
    const { result } = renderHook(
      () => useDataSourceStoreWithSelector(s => s.currentCredentialId),
      { wrapper },
    )
    expect(result.current).toBe('')
  })
})

describe('useDataSourceStore', () => {
  it('should throw when used outside provider', () => {
    expect(() => {
      renderHook(() => useDataSourceStore())
    }).toThrow('Missing DataSourceContext.Provider in the tree')
  })

  it('should return store when used inside provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DataSourceProvider, null, children)
    const { result } = renderHook(
      () => useDataSourceStore(),
      { wrapper },
    )
    expect(result.current).toBeDefined()
    expect(typeof result.current.getState).toBe('function')
  })
})

describe('DataSourceProvider', () => {
  it('should render children', () => {
    const child = React.createElement('div', null, 'Child Content')
    const { getByText } = render(React.createElement(DataSourceProvider, null, child))
    expect(getByText('Child Content')).toBeInTheDocument()
  })
})
