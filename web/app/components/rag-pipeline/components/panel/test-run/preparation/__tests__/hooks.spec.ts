import type { ReactNode } from 'react'
import type { DataSourceNotionWorkspace, NotionPage } from '@/models/common'
import type { CrawlResult, CrawlResultItem } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { createDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { DataSourceContext } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { CrawlStep } from '@/models/datasets'
import { OnlineDriveFileType } from '@/models/pipeline'
import {
  useDatasourceOptions,
  useOnlineDocument,
  useOnlineDrive,
  useTestRunSteps,
  useWebsiteCrawl,
} from '../hooks'

it('moves between datasource selection and document processing', () => {
  const { result } = renderHook(() => useTestRunSteps())

  expect(result.current.currentStep).toBe(1)
  expect(result.current.steps.map((step) => step.value)).toEqual([
    'dataSource',
    'documentProcessing',
  ])

  act(() => result.current.handleNextStep())
  expect(result.current.currentStep).toBe(2)

  act(() => result.current.handleBackStep())
  expect(result.current.currentStep).toBe(1)
})

it('keeps datasource options in sync with live canvas changes', () => {
  const source = createNode({
    id: 'source-1',
    data: { type: BlockEnum.DataSource, title: 'Notion source' },
  })
  const code = createNode({ id: 'code-1', data: { type: BlockEnum.Code, title: 'Code' } })
  const anotherSource = createNode({
    id: 'source-2',
    data: { type: BlockEnum.DataSource, title: 'Drive source' },
  })
  const { result, setCanvas } = renderWorkflowCanvasHook(() => useDatasourceOptions(), {
    nodes: [source, code],
  })

  expect(result.current).toEqual([{ label: 'Notion source', value: 'source-1', data: source.data }])

  act(() => setCanvas({ nodes: [code, anotherSource] }))
  expect(result.current).toEqual([
    { label: 'Drive source', value: 'source-2', data: anotherSource.data },
  ])

  act(() => setCanvas({ nodes: [code] }))
  expect(result.current).toEqual([])
})

const document: NotionPage = {
  workspace_id: 'workspace-1',
  page_id: 'page-1',
  page_name: 'Architecture',
  parent_id: 'root',
  type: 'page',
  page_icon: null,
  is_bound: false,
}
const documentsData: DataSourceNotionWorkspace[] = [
  {
    workspace_id: 'workspace-1',
    workspace_name: 'Engineering',
    workspace_icon: null,
    pages: [document],
  },
]
const websitePage: CrawlResultItem = {
  title: 'Guide',
  source_url: 'https://example.com/guide',
  markdown: '# Guide',
  description: 'A product guide',
}
const crawlResult: CrawlResult = { data: [websitePage], time_consuming: 1 }
const driveFile: OnlineDriveFile = {
  id: 'file-1',
  name: 'Guide.pdf',
  type: OnlineDriveFileType.file,
  size: 1024,
}

function createDataSourceWrapper(store: ReturnType<typeof createDataSourceStore>) {
  return function DataSourceWrapper({ children }: { children: ReactNode }) {
    return createElement(DataSourceContext, { value: store }, children)
  }
}

describe('datasource preparation cleanup', () => {
  it('clears online document state without disturbing unrelated datasource state', () => {
    const store = createDataSourceStore()
    store.setState({
      currentCredentialId: 'credential-1',
      documentsData,
      searchValue: 'architecture',
      selectedPagesId: new Set(['page-1']),
      onlineDocuments: [document],
      currentDocument: document,
    })
    store.getState().previewOnlineDocumentRef.current = document
    const { result } = renderHook(() => useOnlineDocument(), {
      wrapper: createDataSourceWrapper(store),
    })

    act(() => result.current.clearOnlineDocumentData())

    expect(store.getState()).toMatchObject({
      currentCredentialId: 'credential-1',
      documentsData: [],
      searchValue: '',
      onlineDocuments: [],
      currentDocument: undefined,
    })
    expect(store.getState().selectedPagesId).toEqual(new Set())
    expect(store.getState().previewOnlineDocumentRef.current).toBeUndefined()
  })

  it('clears website crawl state without disturbing unrelated datasource state', () => {
    const store = createDataSourceStore()
    store.setState({
      currentCredentialId: 'credential-1',
      step: CrawlStep.finished,
      crawlResult,
      websitePages: [websitePage],
      currentWebsite: websitePage,
      previewIndex: 0,
    })
    store.getState().previewWebsitePageRef.current = websitePage
    const { result } = renderHook(() => useWebsiteCrawl(), {
      wrapper: createDataSourceWrapper(store),
    })

    act(() => result.current.clearWebsiteCrawlData())

    expect(store.getState()).toMatchObject({
      currentCredentialId: 'credential-1',
      step: CrawlStep.init,
      crawlResult: undefined,
      websitePages: [],
      currentWebsite: undefined,
      previewIndex: -1,
    })
    expect(store.getState().previewWebsitePageRef.current).toBeUndefined()
  })

  it('clears online drive selection without disturbing unrelated datasource state', () => {
    const store = createDataSourceStore()
    store.setState({
      currentCredentialId: 'credential-1',
      breadcrumbs: ['Root', 'Guides'],
      onlineDriveFileList: [driveFile],
      bucket: 'documents',
      prefix: ['guides'],
      keywords: 'guide',
      selectedFileIds: ['file-1'],
    })
    store.getState().previewOnlineDriveFileRef.current = driveFile
    const { result } = renderHook(() => useOnlineDrive(), {
      wrapper: createDataSourceWrapper(store),
    })

    act(() => result.current.clearOnlineDriveData())

    expect(store.getState()).toMatchObject({
      currentCredentialId: 'credential-1',
      breadcrumbs: ['Root', 'Guides'],
      onlineDriveFileList: [],
      bucket: '',
      prefix: [],
      keywords: '',
      selectedFileIds: [],
    })
    expect(store.getState().previewOnlineDriveFileRef.current).toBeUndefined()
  })
})
