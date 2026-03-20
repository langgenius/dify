import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDatasourceOptions, useOnlineDocument, useOnlineDrive, useTestRunSteps, useWebsiteCrawl } from '../hooks'

const mockNodes: Array<{ id: string, data: Partial<DataSourceNodeType> & { type: string } }> = []
vi.mock('reactflow', () => ({
  useNodes: () => mockNodes,
}))

const mockDataSourceStoreGetState = vi.fn()
vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/store', () => ({
  useDataSourceStore: () => ({
    getState: mockDataSourceStoreGetState,
  }),
}))

vi.mock('@/app/components/workflow/types', async () => {
  const actual = await vi.importActual<typeof import('@/app/components/workflow/types')>('@/app/components/workflow/types')
  return {
    ...actual,
    BlockEnum: {
      ...actual.BlockEnum,
      DataSource: 'data-source',
    },
  }
})

vi.mock('../../types', () => ({
  TestRunStep: {
    dataSource: 'dataSource',
    documentProcessing: 'documentProcessing',
  },
}))

vi.mock('@/models/datasets', () => ({
  CrawlStep: {
    init: 'init',
  },
}))

describe('useTestRunSteps', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with step 1', () => {
    const { result } = renderHook(() => useTestRunSteps())

    expect(result.current.currentStep).toBe(1)
  })

  it('should return 2 steps (dataSource and documentProcessing)', () => {
    const { result } = renderHook(() => useTestRunSteps())

    expect(result.current.steps).toHaveLength(2)
    expect(result.current.steps[0].value).toBe('dataSource')
    expect(result.current.steps[1].value).toBe('documentProcessing')
  })

  it('should increment step on handleNextStep', () => {
    const { result } = renderHook(() => useTestRunSteps())

    act(() => {
      result.current.handleNextStep()
    })

    expect(result.current.currentStep).toBe(2)
  })

  it('should decrement step on handleBackStep', () => {
    const { result } = renderHook(() => useTestRunSteps())

    act(() => {
      result.current.handleNextStep()
    })
    expect(result.current.currentStep).toBe(2)

    act(() => {
      result.current.handleBackStep()
    })
    expect(result.current.currentStep).toBe(1)
  })

  it('should have translated step labels', () => {
    const { result } = renderHook(() => useTestRunSteps())

    expect(result.current.steps[0].label).toBeDefined()
    expect(typeof result.current.steps[0].label).toBe('string')
  })
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

  it('should return options from DataSource nodes', () => {
    mockNodes.push(
      { id: 'ds-1', data: { type: BlockEnum.DataSource, title: 'Source A' } },
      { id: 'ds-2', data: { type: BlockEnum.DataSource, title: 'Source B' } },
    )

    const { result } = renderHook(() => useDatasourceOptions())

    expect(result.current).toHaveLength(2)
    expect(result.current[0]).toEqual({
      label: 'Source A',
      value: 'ds-1',
      data: expect.objectContaining({ type: 'data-source' }),
    })
    expect(result.current[1]).toEqual({
      label: 'Source B',
      value: 'ds-2',
      data: expect.objectContaining({ type: 'data-source' }),
    })
  })

  it('should filter out non-DataSource nodes', () => {
    mockNodes.push(
      { id: 'ds-1', data: { type: BlockEnum.DataSource, title: 'Source' } },
      { id: 'llm-1', data: { type: BlockEnum.LLM, title: 'LLM' } },
      { id: 'end-1', data: { type: BlockEnum.End, title: 'End' } },
    )

    const { result } = renderHook(() => useDatasourceOptions())

    expect(result.current).toHaveLength(1)
    expect(result.current[0].value).toBe('ds-1')
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
