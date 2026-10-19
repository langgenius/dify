import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  useDatasourceOptions,
  useOnlineDocument,
  useOnlineDrive,
  useTestRunSteps,
  useWebsiteCrawl,
} from '../hooks'

const mockNodes: Array<{ id: string; data: Partial<DataSourceNodeType> & { type: string } }> = []
vi.mock('reactflow', () => ({
  useNodes: () => mockNodes,
}))

const mockDataSourceStoreGetState = vi.fn()
vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/store', () => ({
  useDataSourceStore: () => ({
    getState: mockDataSourceStoreGetState,
  }),
}))

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

describe('useDatasourceOptions', () => {
  beforeEach(() => {
    mockNodes.length = 0
    vi.clearAllMocks()
  })

  it('should return empty options when no DataSource nodes', () => {
    mockNodes.push({ id: 'n1', data: { type: BlockEnum.LLM, title: 'LLM' } })

    const { result } = renderHook(() => useDatasourceOptions())

    expect(result.current).toEqual([])
  })

  it('should filter out non-DataSource nodes', () => {
    mockNodes.push(
      { id: 'ds-1', data: { type: BlockEnum.DataSource, title: 'Source' } },
      { id: 'llm-1', data: { type: BlockEnum.LLM, title: 'LLM' } },
      { id: 'inset-e-1', data: { type: BlockEnum.End, title: 'End' } },
    )

    const { result } = renderHook(() => useDatasourceOptions())

    expect(result.current).toEqual([
      { label: 'Source', value: 'ds-1', data: { type: BlockEnum.DataSource, title: 'Source' } },
    ])
  })
})

describe('useOnlineDocument', () => {
  it('should clear all online document data', () => {
    const mockSetDocumentsData = vi.fn()
    const mockSetSearchValue = vi.fn()
    const mockSetSelectedPagesId = vi.fn()
    const mockSetOnlineDocuments = vi.fn()
    const mockSetCurrentDocument = vi.fn()

    mockDataSourceStoreGetState.mockReturnValue({
      setDocumentsData: mockSetDocumentsData,
      setSearchValue: mockSetSearchValue,
      setSelectedPagesId: mockSetSelectedPagesId,
      setOnlineDocuments: mockSetOnlineDocuments,
      setCurrentDocument: mockSetCurrentDocument,
    })

    const { result } = renderHook(() => useOnlineDocument())

    act(() => {
      result.current.clearOnlineDocumentData()
    })

    expect(mockSetDocumentsData).toHaveBeenCalledWith([])
    expect(mockSetSearchValue).toHaveBeenCalledWith('')
    expect(mockSetSelectedPagesId).toHaveBeenCalledWith(new Set())
    expect(mockSetOnlineDocuments).toHaveBeenCalledWith([])
    expect(mockSetCurrentDocument).toHaveBeenCalledWith(undefined)
  })
})

describe('useWebsiteCrawl', () => {
  it('should clear all website crawl data', () => {
    const mockSetStep = vi.fn()
    const mockSetCrawlResult = vi.fn()
    const mockSetWebsitePages = vi.fn()
    const mockSetPreviewIndex = vi.fn()
    const mockSetCurrentWebsite = vi.fn()

    mockDataSourceStoreGetState.mockReturnValue({
      setStep: mockSetStep,
      setCrawlResult: mockSetCrawlResult,
      setWebsitePages: mockSetWebsitePages,
      setPreviewIndex: mockSetPreviewIndex,
      setCurrentWebsite: mockSetCurrentWebsite,
    })

    const { result } = renderHook(() => useWebsiteCrawl())

    act(() => {
      result.current.clearWebsiteCrawlData()
    })

    expect(mockSetStep).toHaveBeenCalledWith('init')
    expect(mockSetCrawlResult).toHaveBeenCalledWith(undefined)
    expect(mockSetCurrentWebsite).toHaveBeenCalledWith(undefined)
    expect(mockSetWebsitePages).toHaveBeenCalledWith([])
    expect(mockSetPreviewIndex).toHaveBeenCalledWith(-1)
  })
})

describe('useOnlineDrive', () => {
  it('should clear all online drive data', () => {
    const mockSetOnlineDriveFileList = vi.fn()
    const mockSetBucket = vi.fn()
    const mockSetPrefix = vi.fn()
    const mockSetKeywords = vi.fn()
    const mockSetSelectedFileIds = vi.fn()

    mockDataSourceStoreGetState.mockReturnValue({
      setOnlineDriveFileList: mockSetOnlineDriveFileList,
      setBucket: mockSetBucket,
      setPrefix: mockSetPrefix,
      setKeywords: mockSetKeywords,
      setSelectedFileIds: mockSetSelectedFileIds,
    })

    const { result } = renderHook(() => useOnlineDrive())

    act(() => {
      result.current.clearOnlineDriveData()
    })

    expect(mockSetOnlineDriveFileList).toHaveBeenCalledWith([])
    expect(mockSetBucket).toHaveBeenCalledWith('')
    expect(mockSetPrefix).toHaveBeenCalledWith([])
    expect(mockSetKeywords).toHaveBeenCalledWith('')
    expect(mockSetSelectedFileIds).toHaveBeenCalledWith([])
  })
})
