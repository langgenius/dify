import type { IndexingType } from './use-indexing-config'
import type { NotionPage } from '@/models/common'
import type {
  ChunkingMode,
  CrawlOptions,
  CrawlResultItem,
  CustomFile,
  ProcessRule,
} from '@/models/datasets'
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
  files: CustomFile[]
  previewFileName?: string
  // Notion data source
  previewNotionPage?: NotionPage
  notionCredentialId: string
  // Website data source
  previewWebsitePage?: CrawlResultItem
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
    previewFileName,
    previewNotionPage,
    notionCredentialId,
    previewWebsitePage,
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

  const getEstimateParams = useCallback(() => {
    if (dataSourceType === DataSourceType.FILE) {
      return getFileIndexingEstimateParamsForFile({
        docForm: currentDocForm,
        docLanguage,
        dataSourceType: DataSourceType.FILE,
        files: previewFileName ? [files.find((file) => file.name === previewFileName)!] : files,
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
        notionPages: previewNotionPage ? [previewNotionPage] : [],
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
      websitePages: previewWebsitePage ? [previewWebsitePage] : [],
      crawlOptions,
      websiteCrawlProvider: websiteCrawlProvider ?? DataSourceProvider.jinaReader,
      websiteCrawlJobId: websiteCrawlJobId ?? '',
      indexingTechnique,
      processRule,
      dataset_id: datasetId || '',
    })
  }, [
    dataSourceType,
    currentDocForm,
    docLanguage,
    files,
    previewFileName,
    previewNotionPage,
    notionCredentialId,
    previewWebsitePage,
    crawlOptions,
    websiteCrawlProvider,
    websiteCrawlJobId,
    indexingTechnique,
    processRule,
    datasetId,
  ])

  const { mutate } = estimateMutation
  const fetchEstimate = useCallback(() => {
    mutate({ body: getEstimateParams() })
  }, [mutate, getEstimateParams])

  return {
    currentMutation: estimateMutation,
    estimate: estimateMutation.data,
    isIdle: estimateMutation.isIdle,
    isPending: estimateMutation.isPending,
    fetchEstimate,
    reset: estimateMutation.reset,
  }
}
