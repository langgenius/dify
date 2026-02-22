import type { ReactNode } from 'react'
import type { DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile as File, FileItem } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CrawlStep } from '@/models/datasets'
import { createDataSourceStore } from '../../data-source/store'
import { DataSourceContext } from '../../data-source/store/provider'
import { useLocalFile, useOnlineDocument, useOnlineDrive, useWebsiteCrawl } from '../use-datasource-store'

const createWrapper = (store: ReturnType<typeof createDataSourceStore>) => {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(DataSourceContext.Provider, { value: store }, children)
}

describe('useLocalFile', () => {
  let store: ReturnType<typeof createDataSourceStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = createDataSourceStore()
  })

  it('should return local file list and initial state', () => {
    const { result } = renderHook(() => useLocalFile(), { wrapper: createWrapper(store) })

    expect(result.current.localFileList).toEqual([])
    expect(result.current.allFileLoaded).toBe(false)
    expect(result.current.currentLocalFile).toBeUndefined()
  })

  it('should compute allFileLoaded when all files have ids', () => {
    store.getState().setLocalFileList([
      { file: { id: 'f1', name: 'a.pdf' } },
      { file: { id: 'f2', name: 'b.pdf' } },
    ] as unknown as FileItem[])

    const { result } = renderHook(() => useLocalFile(), { wrapper: createWrapper(store) })
    expect(result.current.allFileLoaded).toBe(true)
  })

  it('should compute allFileLoaded as false when some files lack ids', () => {
    store.getState().setLocalFileList([
      { file: { id: 'f1', name: 'a.pdf' } },
      { file: { id: '', name: 'b.pdf' } },
    ] as unknown as FileItem[])

    const { result } = renderHook(() => useLocalFile(), { wrapper: createWrapper(store) })
    expect(result.current.allFileLoaded).toBe(false)
  })

  it('should hide preview local file', () => {
    store.getState().setCurrentLocalFile({ id: 'f1' } as unknown as File)
    const { result } = renderHook(() => useLocalFile(), { wrapper: createWrapper(store) })

    act(() => {
      result.current.hidePreviewLocalFile()
    })
    expect(store.getState().currentLocalFile).toBeUndefined()
  })
})

describe('useOnlineDocument', () => {
  let store: ReturnType<typeof createDataSourceStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = createDataSourceStore()
  })

  it('should return initial state', () => {
    const { result } = renderHook(() => useOnlineDocument(), { wrapper: createWrapper(store) })

    expect(result.current.onlineDocuments).toEqual([])
    expect(result.current.currentDocument).toBeUndefined()
    expect(result.current.currentWorkspace).toBeUndefined()
  })

  it('should build PagesMapAndSelectedPagesId from documentsData', () => {
    store.getState().setDocumentsData([
      { workspace_id: 'w1', pages: [{ page_id: 'p1', page_name: 'Page 1' }] },
    ] as unknown as DataSourceNotionWorkspace[])

    const { result } = renderHook(() => useOnlineDocument(), { wrapper: createWrapper(store) })
    expect(result.current.PagesMapAndSelectedPagesId).toHaveProperty('p1')
    expect(result.current.PagesMapAndSelectedPagesId.p1.workspace_id).toBe('w1')
  })

  it('should hide preview online document', () => {
    store.getState().setCurrentDocument({ page_id: 'p1' } as unknown as NotionPage)
    const { result } = renderHook(() => useOnlineDocument(), { wrapper: createWrapper(store) })

    act(() => {
      result.current.hidePreviewOnlineDocument()
    })
    expect(store.getState().currentDocument).toBeUndefined()
  })

  it('should clear online document data', () => {
    store.getState().setDocumentsData([{ workspace_id: 'w1', pages: [] }] as unknown as DataSourceNotionWorkspace[])
    store.getState().setSearchValue('test')
    store.getState().setOnlineDocuments([{ page_id: 'p1' }] as unknown as NotionPage[])

    const { result } = renderHook(() => useOnlineDocument(), { wrapper: createWrapper(store) })
    act(() => {
      result.current.clearOnlineDocumentData()
    })

    expect(store.getState().documentsData).toEqual([])
    expect(store.getState().searchValue).toBe('')
    expect(store.getState().onlineDocuments).toEqual([])
  })
})

describe('useWebsiteCrawl', () => {
  let store: ReturnType<typeof createDataSourceStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = createDataSourceStore()
  })

  it('should return initial state', () => {
    const { result } = renderHook(() => useWebsiteCrawl(), { wrapper: createWrapper(store) })

    expect(result.current.websitePages).toEqual([])
    expect(result.current.currentWebsite).toBeUndefined()
  })

  it('should hide website preview', () => {
    store.getState().setCurrentWebsite({ title: 'Test' } as unknown as CrawlResultItem)
    store.getState().setPreviewIndex(2)
    const { result } = renderHook(() => useWebsiteCrawl(), { wrapper: createWrapper(store) })

    act(() => {
      result.current.hideWebsitePreview()
    })

    expect(store.getState().currentWebsite).toBeUndefined()
    expect(store.getState().previewIndex).toBe(-1)
  })

  it('should clear website crawl data', () => {
    store.getState().setStep(CrawlStep.running)
    store.getState().setWebsitePages([{ title: 'Test' }] as unknown as CrawlResultItem[])

    const { result } = renderHook(() => useWebsiteCrawl(), { wrapper: createWrapper(store) })
    act(() => {
      result.current.clearWebsiteCrawlData()
    })

    expect(store.getState().step).toBe(CrawlStep.init)
    expect(store.getState().websitePages).toEqual([])
    expect(store.getState().currentWebsite).toBeUndefined()
  })
})

describe('useOnlineDrive', () => {
  let store: ReturnType<typeof createDataSourceStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = createDataSourceStore()
  })

  it('should return initial state', () => {
    const { result } = renderHook(() => useOnlineDrive(), { wrapper: createWrapper(store) })

    expect(result.current.onlineDriveFileList).toEqual([])
    expect(result.current.selectedFileIds).toEqual([])
    expect(result.current.selectedOnlineDriveFileList).toEqual([])
  })

  it('should compute selected online drive file list', () => {
    const files = [
      { id: 'f1', name: 'a.pdf' },
      { id: 'f2', name: 'b.pdf' },
      { id: 'f3', name: 'c.pdf' },
    ] as unknown as OnlineDriveFile[]
    store.getState().setOnlineDriveFileList(files)
    store.getState().setSelectedFileIds(['f1', 'f3'])

    const { result } = renderHook(() => useOnlineDrive(), { wrapper: createWrapper(store) })
    expect(result.current.selectedOnlineDriveFileList).toEqual([files[0], files[2]])
  })

  it('should clear online drive data', () => {
    store.getState().setOnlineDriveFileList([{ id: 'f1' }] as unknown as OnlineDriveFile[])
    store.getState().setBucket('b1')
    store.getState().setPrefix(['p1'])
    store.getState().setKeywords('kw')
    store.getState().setSelectedFileIds(['f1'])

    const { result } = renderHook(() => useOnlineDrive(), { wrapper: createWrapper(store) })
    act(() => {
      result.current.clearOnlineDriveData()
    })

    expect(store.getState().onlineDriveFileList).toEqual([])
    expect(store.getState().bucket).toBe('')
    expect(store.getState().prefix).toEqual([])
    expect(store.getState().keywords).toBe('')
    expect(store.getState().selectedFileIds).toEqual([])
  })
})
