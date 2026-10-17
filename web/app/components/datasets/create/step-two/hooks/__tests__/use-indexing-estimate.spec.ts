import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DataSourceProvider } from '@/models/common'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useIndexingEstimate } from '../use-indexing-estimate'

const estimate = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.indexingEstimate.post': estimate,
    }),
  }
})

describe('useIndexingEstimate', () => {
  const defaultOptions: Parameters<typeof useIndexingEstimate>[0] = {
    dataSourceType: DataSourceType.FILE,
    datasetId: 'dataset-1',
    currentDocForm: ChunkingMode.text,
    docLanguage: 'English',
    files: [{ id: 'f-1', name: 'test.txt' }],
    previewNotionPage: {
      page_id: 'page-1',
      page_name: 'Page',
      page_icon: null,
      type: 'page',
      workspace_id: 'workspace-1',
    },
    notionCredentialId: 'credential-1',
    previewWebsitePage: {
      source_url: 'https://example.com',
      title: 'Example',
      markdown: 'Content',
      description: '',
    },
    websiteCrawlProvider: DataSourceProvider.jinaReader,
    websiteCrawlJobId: 'job-1',
    indexingTechnique: 'high_quality',
    processRule: {
      mode: 'custom',
      rules: { pre_processing_rules: [], segmentation: { separator: '\n', max_tokens: 500 } },
    },
  }

  const sentBody = () => estimate.mock.calls.at(-1)?.[0].body

  beforeEach(() => {
    estimate.mockReset().mockResolvedValue({ tokens: 100, total_segments: 5 })
  })

  it('moves from idle through pending to the estimate and clears the result on reset', async () => {
    const request = createDeferred<{ tokens: number; total_segments: number }>()
    estimate.mockReturnValue(request.promise)
    const { result } = renderHook(() => useIndexingEstimate(defaultOptions))
    expect(result.current.isIdle).toBe(true)
    expect(result.current.estimate).toBeUndefined()
    act(() => result.current.fetchEstimate())
    await waitFor(() => expect(result.current.isPending).toBe(true))
    await act(async () => request.resolve({ tokens: 100, total_segments: 5 }))
    await waitFor(() => expect(result.current.estimate).toEqual({ tokens: 100, total_segments: 5 }))
    expect(result.current.isPending).toBe(false)
    expect(sentBody()).toMatchObject({
      info_list: { data_source_type: 'upload_file', file_info_list: { file_ids: ['f-1'] } },
      doc_form: 'text_model',
      dataset_id: 'dataset-1',
    })
    act(() => result.current.reset())
    await waitFor(() => expect(result.current.isIdle).toBe(true))
    expect(result.current.estimate).toBeUndefined()
  })

  describe('fetchEstimate', () => {
    it('estimates the previewed Notion page', async () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({ ...defaultOptions, dataSourceType: DataSourceType.NOTION }),
      )
      await act(async () => result.current.fetchEstimate())

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

    it('estimates the previewed website page', async () => {
      const { result } = renderHook(() =>
        useIndexingEstimate({ ...defaultOptions, dataSourceType: DataSourceType.WEB }),
      )
      await act(async () => result.current.fetchEstimate())

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
})
