import type { ReactNode } from 'react'
import type { DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import type { CrawlResultItem, FileItem } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { CrawlStep } from '@/models/datasets'
import { createDataSourceStore } from '../../data-source/store'
import { DataSourceContext } from '../../data-source/store/provider'
import {
  useLocalFile,
  useOnlineDocument,
  useOnlineDrive,
  useWebsiteCrawl,
} from '../use-datasource-store'

const createWrapper = (store: ReturnType<typeof createDataSourceStore>) => {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(DataSourceContext.Provider, { value: store }, children)
}

const fileItem = (id: string, name: string): FileItem => ({
  fileID: name,
  file: Object.assign(new File(['content'], name), { id }),
  progress: id ? 100 : 0,
})
const page: NotionPage = {
  page_id: 'p1',
  page_name: 'Page 1',
  workspace_id: 'w1',
  page_icon: null,
  parent_id: '',
  type: 'page',
  is_bound: true,
}
const workspace: DataSourceNotionWorkspace = {
  workspace_id: 'w1',
  workspace_name: 'Docs',
  workspace_icon: null,
  pages: [page],
}
const website: CrawlResultItem = {
  title: 'Test',
  source_url: 'https://example.com',
  markdown: 'Test',
  description: '',
}
const driveFiles: OnlineDriveFile[] = [
  { id: 'f1', name: 'a.pdf', type: 'file' },
  { id: 'f2', name: 'b.pdf', type: 'file' },
  { id: 'f3', name: 'c.pdf', type: 'file' },
]

describe('useLocalFile', () => {
  let store: ReturnType<typeof createDataSourceStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = createDataSourceStore()
  })

  it('should compute allFileLoaded when all files have ids', () => {
    store.getState().setLocalFileList([fileItem('f1', 'a.pdf'), fileItem('f2', 'b.pdf')])

    const { result } = renderHook(() => useLocalFile(), { wrapper: createWrapper(store) })
    expect(result.current.allFileLoaded).toBe(true)
  })

  it('should compute allFileLoaded as false when some files lack ids', () => {
    store.getState().setLocalFileList([fileItem('f1', 'a.pdf'), fileItem('', 'b.pdf')])

    const { result } = renderHook(() => useLocalFile(), { wrapper: createWrapper(store) })
    expect(result.current.allFileLoaded).toBe(false)
  })
})

describe('useOnlineDocument', () => {
  let store: ReturnType<typeof createDataSourceStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = createDataSourceStore()
  })

  it('should build PagesMapAndSelectedPagesId from documentsData', () => {
    store.getState().setDocumentsData([workspace])

    const { result } = renderHook(() => useOnlineDocument(), { wrapper: createWrapper(store) })
    expect(result.current.PagesMapAndSelectedPagesId).toHaveProperty('p1')
    expect(result.current.PagesMapAndSelectedPagesId.p1!.workspace_id).toBe('w1')
  })

  it('should clear online document data', () => {
    store.getState().setDocumentsData([workspace])
    store.getState().setSearchValue('test')
    store.getState().setOnlineDocuments([page])

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

  it('should hide website preview', () => {
    store.getState().setCurrentWebsite(website)
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
    store.getState().setWebsitePages([website])

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

  it('should compute selected online drive file list', () => {
    const files = driveFiles
    store.getState().setOnlineDriveFileList(files)
    store.getState().setSelectedFileIds(['f1', 'f3'])

    const { result } = renderHook(() => useOnlineDrive(), { wrapper: createWrapper(store) })
    expect(result.current.selectedOnlineDriveFileList).toEqual([files[0], files[2]])
  })

  it('should clear online drive data', () => {
    store.getState().setOnlineDriveFileList([driveFiles[0]!])
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
