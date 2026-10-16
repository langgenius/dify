import type { IndexingType } from '../use-indexing-config'
import type { NotionPage } from '@/models/common'
import type { ChunkingMode, CrawlResultItem, CustomFile, ProcessRule } from '@/models/datasets'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DataSourceProvider } from '@/models/common'
import { DataSourceType } from '@/models/datasets'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'datasets.indexingEstimate.post': () => ({
      mutate: mocks.mutate,
      reset: mocks.reset,
      data: { tokens: 100, total_segments: 5 },
      isIdle: true,
      isPending: false,
    }),
  })
})

const { useIndexingEstimate } = await import('../use-indexing-estimate')

describe('useIndexingEstimate', () => {
  const defaultOptions = {
    dataSourceType: DataSourceType.FILE,
    datasetId: 'dataset-1',
    currentDocForm: 'text_model' as ChunkingMode,
    docLanguage: 'English',
    files: [{ id: 'f-1', name: 'test.txt' }] as unknown as CustomFile[],
    previewNotionPage: {
      page_id: 'page-1',
      page_name: 'Page',
      page_icon: null,
      type: 'page',
      workspace_id: 'workspace-1',
    } as unknown as NotionPage,
    notionCredentialId: 'credential-1',
    previewWebsitePage: { source_url: 'https://example.com' } as unknown as CrawlResultItem,
    websiteCrawlProvider: DataSourceProvider.jinaReader,
    websiteCrawlJobId: 'job-1',
    indexingTechnique: 'high_quality' as unknown as IndexingType,
    processRule: { mode: 'custom', rules: {} } as unknown as ProcessRule,
  }

  const sentBody = () => mocks.mutate.mock.calls.at(-1)?.[0].body

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes the estimate', () => {
    const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
    expect(result.current.estimate).toEqual({ tokens: 100, total_segments: 5 })
  })

  describe('fetchEstimate', () => {
    it('estimates the uploaded files', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      result.current.fetchEstimate()

      expect(sentBody()).toMatchObject({
        info_list: { data_source_type: 'upload_file', file_info_list: { file_ids: ['f-1'] } },
        doc_form: 'text_model',
        dataset_id: 'dataset-1',
      })
    })

    it('estimates the previewed Notion page', () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({ ...defaultOptions, dataSourceType: DataSourceType.NOTION }),
      )
      result.current.fetchEstimate()

      expect(sentBody()).toMatchObject({
        info_list: {
          data_source_type: 'notion_import',
          notion_info_list: [
            {
              credential_id: 'credential-1',
              workspace_id: 'workspace-1',
              pages: [{ page_id: 'page-1' }],
            },
          ],
        },
      })
    })

    it('estimates the previewed website page', () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({ ...defaultOptions, dataSourceType: DataSourceType.WEB }),
      )
      result.current.fetchEstimate()

      expect(sentBody()).toMatchObject({
        info_list: {
          data_source_type: 'website_crawl',
          website_info_list: {
            provider: DataSourceProvider.jinaReader,
            job_id: 'job-1',
            urls: ['https://example.com'],
          },
        },
      })
    })
  })

  describe('state properties', () => {
    it('should expose isIdle', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      expect(result.current.isIdle).toBe(true)
    })

    it('should expose isPending', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      expect(result.current.isPending).toBe(false)
    })

    it('should expose reset function', () => {
      const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
      result.current.reset()
      expect(mocks.reset).toHaveBeenCalledOnce()
    })
  })
})
