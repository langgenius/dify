import type { IndexingType } from './use-indexing-config'
import type { NotionPage } from '@/models/common'
import type { ChunkingMode, CrawlOptions, CrawlResultItem, CustomFile, ProcessRule } from '@/models/datasets'
import { useCallback } from 'react'
import { DataSourceProvider } from '@/models/common'
import { DataSourceType } from '@/models/datasets'
import {
  useFetchFileIndexingEstimateForFile,
  useFetchFileIndexingEstimateForNotion,
  useFetchFileIndexingEstimateForWeb,
} from '@/service/knowledge/use-create-dataset'

export type UseIndexingEstimateOptions = {
  dataSourceType: DataSourceType
  datasetId?: string
  // Document settings
  currentDocForm: ChunkingMode
  docLanguage: string
  // File data source
  files: CustomFile[]
  previewFileName?: string
  // Notion data source
  previewNotionPage: NotionPage
  notionCredentialId: string
  // Website data source
  previewWebsitePage: CrawlResultItem
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

  // File indexing estimate
  const fileQuery = useFetchFileIndexingEstimateForFile({
    docForm: currentDocForm,
    docLanguage,
    dataSourceType: DataSourceType.FILE,
    files: previewFileName
      ? [files.find(file => file.name === previewFileName)!]
      : files,
    indexingTechnique,
    processRule,
    dataset_id: datasetId!,
  })

  // Notion indexing estimate
  const notionQuery = useFetchFileIndexingEstimateForNotion({
    docForm: currentDocForm,
    docLanguage,
    dataSourceType: DataSourceType.NOTION,
    notionPages: [previewNotionPage],
    indexingTechnique,
    processRule,
    dataset_id: datasetId || '',
    credential_id: notionCredentialId,
  })

  // Website indexing estimate
  const websiteQuery = useFetchFileIndexingEstimateForWeb({
    docForm: currentDocForm,
    docLanguage,
    dataSourceType: DataSourceType.WEB,
    websitePages: [previewWebsitePage],
    crawlOptions,
    websiteCrawlProvider: websiteCrawlProvider ?? DataSourceProvider.jinaReader,
    websiteCrawlJobId: websiteCrawlJobId ?? '',
    indexingTechnique,
    processRule,
    dataset_id: datasetId || '',
  })

  // Get current mutation based on data source type
  const getCurrentMutation = useCallback(() => {
    if (dataSourceType === DataSourceType.FILE)
      return fileQuery
    if (dataSourceType === DataSourceType.NOTION)
      return notionQuery
    return websiteQuery
  }, [dataSourceType, fileQuery, notionQuery, websiteQuery])

  const currentMutation = getCurrentMutation()

  // Trigger estimate fetch
  const fetchEstimate = useCallback(() => {
    if (dataSourceType === DataSourceType.FILE)
      fileQuery.mutate()
    else if (dataSourceType === DataSourceType.NOTION)
      notionQuery.mutate()
    else
      websiteQuery.mutate()
  }, [dataSourceType, fileQuery, notionQuery, websiteQuery])

  return {
    currentMutation,
    estimate: currentMutation.data,
    isIdle: currentMutation.isIdle,
    isPending: currentMutation.isPending,
    fetchEstimate,
    reset: currentMutation.reset,
  }
}

export type IndexingEstimate = ReturnType<typeof useIndexingEstimate>
