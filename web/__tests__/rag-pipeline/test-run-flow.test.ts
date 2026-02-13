/**
 * Integration test: Test run end-to-end flow
 *
 * Validates the data flow through test-run preparation hooks:
 * step navigation, datasource filtering, and data clearing.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mutable holder so mock data can reference BlockEnum after imports
const mockNodesHolder = vi.hoisted(() => ({ value: [] as Record<string, unknown>[] }))

vi.mock('reactflow', () => ({
  useNodes: () => mockNodesHolder.value,
}))

mockNodesHolder.value = [
  {
    id: 'ds-1',
    data: {
      type: BlockEnum.DataSource,
      title: 'Local Files',
      datasource_type: 'upload_file',
      datasource_configurations: { datasource_label: 'Upload', upload_file_config: {} },
    },
  },
  {
    id: 'ds-2',
    data: {
      type: BlockEnum.DataSource,
      title: 'Web Crawl',
      datasource_type: 'website_crawl',
      datasource_configurations: { datasource_label: 'Crawl' },
    },
  },
  {
    id: 'kb-1',
    data: {
      type: BlockEnum.KnowledgeBase,
      title: 'Knowledge Base',
    },
  },
]

// Mock the Zustand store used by the hooks
const mockSetDocumentsData = vi.fn()
const mockSetSearchValue = vi.fn()
const mockSetSelectedPagesId = vi.fn()
const mockSetOnlineDocuments = vi.fn()
const mockSetCurrentDocument = vi.fn()
const mockSetStep = vi.fn()
const mockSetCrawlResult = vi.fn()
const mockSetWebsitePages = vi.fn()
const mockSetPreviewIndex = vi.fn()
const mockSetCurrentWebsite = vi.fn()
const mockSetOnlineDriveFileList = vi.fn()
const mockSetBucket = vi.fn()
const mockSetPrefix = vi.fn()
const mockSetKeywords = vi.fn()
const mockSetSelectedFileIds = vi.fn()

vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/store', () => ({
  useDataSourceStore: () => ({
    getState: () => ({
      setDocumentsData: mockSetDocumentsData,
      setSearchValue: mockSetSearchValue,
      setSelectedPagesId: mockSetSelectedPagesId,
      setOnlineDocuments: mockSetOnlineDocuments,
      setCurrentDocument: mockSetCurrentDocument,
      setStep: mockSetStep,
      setCrawlResult: mockSetCrawlResult,
      setWebsitePages: mockSetWebsitePages,
      setPreviewIndex: mockSetPreviewIndex,
      setCurrentWebsite: mockSetCurrentWebsite,
      setOnlineDriveFileList: mockSetOnlineDriveFileList,
      setBucket: mockSetBucket,
      setPrefix: mockSetPrefix,
      setKeywords: mockSetKeywords,
      setSelectedFileIds: mockSetSelectedFileIds,
    }),
  }),
}))

vi.mock('@/models/datasets', () => ({
  CrawlStep: {
    init: 'init',
  },
}))

describe('Test Run Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Step Navigation', () => {
    it('should start at step 1 and navigate forward', async () => {
      const { useTestRunSteps } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
      const { result } = renderHook(() => useTestRunSteps())

      expect(result.current.currentStep).toBe(1)

      act(() => {
        result.current.handleNextStep()
      })

      expect(result.current.currentStep).toBe(2)
    })

    it('should navigate back from step 2 to step 1', async () => {
      const { useTestRunSteps } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
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

    it('should provide labeled steps', async () => {
      const { useTestRunSteps } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
      const { result } = renderHook(() => useTestRunSteps())

      expect(result.current.steps).toHaveLength(2)
      expect(result.current.steps[0].value).toBe('dataSource')
      expect(result.current.steps[1].value).toBe('documentProcessing')
    })
  })

  describe('Datasource Options', () => {
    it('should filter nodes to only DataSource type', async () => {
      const { useDatasourceOptions } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
      const { result } = renderHook(() => useDatasourceOptions())

      // Should only include DataSource nodes, not KnowledgeBase
      expect(result.current).toHaveLength(2)
      expect(result.current[0].value).toBe('ds-1')
      expect(result.current[1].value).toBe('ds-2')
    })

    it('should include node data in options', async () => {
      const { useDatasourceOptions } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current[0].label).toBe('Local Files')
      expect(result.current[0].data.type).toBe(BlockEnum.DataSource)
    })
  })

  describe('Data Clearing Flow', () => {
    it('should clear online document data', async () => {
      const { useOnlineDocument } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
      const { result } = renderHook(() => useOnlineDocument())

      act(() => {
        result.current.clearOnlineDocumentData()
      })

      expect(mockSetDocumentsData).toHaveBeenCalledWith([])
      expect(mockSetSearchValue).toHaveBeenCalledWith('')
      expect(mockSetSelectedPagesId).toHaveBeenCalledWith(expect.any(Set))
      expect(mockSetOnlineDocuments).toHaveBeenCalledWith([])
      expect(mockSetCurrentDocument).toHaveBeenCalledWith(undefined)
    })

    it('should clear website crawl data', async () => {
      const { useWebsiteCrawl } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
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

    it('should clear online drive data', async () => {
      const { useOnlineDrive } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
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

  describe('Full Flow Simulation', () => {
    it('should support complete step navigation cycle', async () => {
      const { useTestRunSteps } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
      const { result } = renderHook(() => useTestRunSteps())

      // Start at step 1
      expect(result.current.currentStep).toBe(1)

      // Move to step 2
      act(() => {
        result.current.handleNextStep()
      })
      expect(result.current.currentStep).toBe(2)

      // Go back to step 1
      act(() => {
        result.current.handleBackStep()
      })
      expect(result.current.currentStep).toBe(1)

      // Move forward again
      act(() => {
        result.current.handleNextStep()
      })
      expect(result.current.currentStep).toBe(2)
    })

    it('should not regress when clearing all data sources in sequence', async () => {
      const {
        useOnlineDocument,
        useWebsiteCrawl,
        useOnlineDrive,
      } = await import(
        '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks',
      )
      const { result: docResult } = renderHook(() => useOnlineDocument())
      const { result: crawlResult } = renderHook(() => useWebsiteCrawl())
      const { result: driveResult } = renderHook(() => useOnlineDrive())

      // Clear all data sources
      act(() => {
        docResult.current.clearOnlineDocumentData()
        crawlResult.current.clearWebsiteCrawlData()
        driveResult.current.clearOnlineDriveData()
      })

      expect(mockSetDocumentsData).toHaveBeenCalledWith([])
      expect(mockSetStep).toHaveBeenCalledWith('init')
      expect(mockSetOnlineDriveFileList).toHaveBeenCalledWith([])
    })
  })
})
