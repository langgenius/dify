import type { StepTwoFile, StepTwoNotionPage } from '../types'
import type { IndexingType } from './use-indexing-config'
import type { ChunkingMode, CrawlOptions, CrawlResultItem, ProcessRule } from '@/models/datasets'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { DataSourceProvider } from '@/models/common'
import { DataSourceType } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import {
  getFileIndexingEstimateParamsForFile,
  getFileIndexingEstimateParamsForNotion,
  getFileIndexingEstimateParamsForWeb,
} from '../creation-params'

type UseIndexingEstimateOptions = {
  dataSourceType: DataSourceType
  datasetId?: string
  // Document settings
  currentDocForm: ChunkingMode
  docLanguage: string
  // File data source
  files: StepTwoFile[]
  previewItemId?: string
  // Notion data source
  notionPages: StepTwoNotionPage[]
  notionCredentialId: string
  // Website data source
  websitePages: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider?: DataSourceProvider
  websiteCrawlJobId?: string
  // Processing
  indexingTechnique: IndexingType
  processRule: ProcessRule
}

export const useIndexingEstimate = (options: UseIndexingEstimateOptions) => {
  const {
    dataSourceType,
    datasetId,
    currentDocForm,
    docLanguage,
    files,
    previewItemId,
    notionPages,
    notionCredentialId,
    websitePages,
    crawlOptions,
    websiteCrawlProvider,
    websiteCrawlJobId,
    indexingTechnique,
    processRule,
  } = options

  // Step two keeps one data source, so one estimate request serves it.
  const estimateMutation = useMutation(
    consoleQuery.datasets.indexingEstimate.post.mutationOptions(),
  )

  const getEstimateParams = useCallback(
    (selectedId?: string) => {
      if (dataSourceType === DataSourceType.FILE) {
        return getFileIndexingEstimateParamsForFile({
          docForm: currentDocForm,
          docLanguage,
          dataSourceType: DataSourceType.FILE,
          files: selectedId ? files.filter((file) => file.id === selectedId) : files,
          indexingTechnique,
          processRule,
          dataset_id: datasetId!,
        })
      }
      if (dataSourceType === DataSourceType.NOTION) {
        return getFileIndexingEstimateParamsForNotion({
          docForm: currentDocForm,
          docLanguage,
          dataSourceType: DataSourceType.NOTION,
          notionPages: notionPages.filter((page) => page.page_id === selectedId),
          indexingTechnique,
          processRule,
          dataset_id: datasetId || '',
          credential_id: notionCredentialId,
        })
      }
      return getFileIndexingEstimateParamsForWeb({
        docForm: currentDocForm,
        docLanguage,
        dataSourceType: DataSourceType.WEB,
        websitePages: websitePages.filter((page) => page.source_url === selectedId),
        crawlOptions,
        websiteCrawlProvider: websiteCrawlProvider ?? DataSourceProvider.jinaReader,
        websiteCrawlJobId: websiteCrawlJobId ?? '',
        indexingTechnique,
        processRule,
        dataset_id: datasetId || '',
      })
    },
    [
      dataSourceType,
      currentDocForm,
      docLanguage,
      files,
      notionPages,
      notionCredentialId,
      websitePages,
      crawlOptions,
      websiteCrawlProvider,
      websiteCrawlJobId,
      indexingTechnique,
      processRule,
      datasetId,
    ],
  )

  const { mutate } = estimateMutation
  const fetchEstimate = useCallback(
    (selectedId = previewItemId) => {
      mutate({ body: getEstimateParams(selectedId) })
    },
    [mutate, getEstimateParams, previewItemId],
  )

  return {
    currentMutation: estimateMutation,
    estimate: estimateMutation.data,
    isIdle: estimateMutation.isIdle,
    isPending: estimateMutation.isPending,
    fetchEstimate,
    reset: estimateMutation.reset,
  }
}
