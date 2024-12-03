import groupBy from 'lodash-es/groupBy'
import { useMutation } from '@tanstack/react-query'
import { fetchFileIndexingEstimate } from './datasets'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { CrawlOptions, CrawlResultItem, CustomFile, DataSourceType, DocForm, IndexingEstimateParams, NotionInfo, ProcessRule } from '@/models/datasets'
import type { DataSourceProvider, NotionPage } from '@/models/common'

const getNotionInfo = (
  notionPages: NotionPage[],
) => {
  const workspacesMap = groupBy(notionPages, 'workspace_id')
  const workspaces = Object.keys(workspacesMap).map((workspaceId) => {
    return {
      workspaceId,
      pages: workspacesMap[workspaceId],
    }
  })
  return workspaces.map((workspace) => {
    return {
      workspace_id: workspace.workspaceId,
      pages: workspace.pages.map((page) => {
        const { page_id, page_name, page_icon, type } = page
        return {
          page_id,
          page_name,
          page_icon,
          type,
        }
      }),
    }
  }) as NotionInfo[]
}

const getWebsiteInfo = (
  opts: {
    websiteCrawlProvider: DataSourceProvider
    websiteCrawlJobId: string
    websitePages: CrawlResultItem[]
    crawlOptions?: CrawlOptions
  },
) => {
  const { websiteCrawlProvider, websiteCrawlJobId, websitePages, crawlOptions } = opts
  return {
    provider: websiteCrawlProvider,
    job_id: websiteCrawlJobId,
    urls: websitePages.map(page => page.source_url),
    only_main_content: crawlOptions?.only_main_content,
  }
}

type GetFileIndexingEstimateParamsOptionBase = {
  docForm: DocForm
  docLanguage: string
  indexingTechnique: IndexingType
  processRule: ProcessRule
  dataset_id: string
}

type GetFileIndexingEstimateParamsOptionFile = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: DataSourceType.FILE
  files: CustomFile[]
}

type GetFileIndexingEstimateParamsOptionNotion = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: DataSourceType.NOTION
  notionPages: NotionPage[]
}

type GetFileIndexingEstimateParamsOptionWeb = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: DataSourceType.WEB
  websitePages: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider: DataSourceProvider
  websiteCrawlJobId: string
}

const getFileIndexingEstimateParamsForFile = ({
  docForm,
  docLanguage,
  dataSourceType,
  files,
  indexingTechnique,
  processRule,
  dataset_id,
}: GetFileIndexingEstimateParamsOptionFile): IndexingEstimateParams => {
  return {
    info_list: {
      data_source_type: dataSourceType,
      file_info_list: {
        file_ids: files.map(file => file.id) as string[],
      },
    },
    indexing_technique: indexingTechnique,
    process_rule: processRule,
    doc_form: docForm,
    doc_language: docLanguage,
    dataset_id,
  }
}

const getFileIndexingEstimateParamsForNotion = ({
  docForm,
  docLanguage,
  dataSourceType,
  notionPages,
  indexingTechnique,
  processRule,
  dataset_id,
}: GetFileIndexingEstimateParamsOptionNotion): IndexingEstimateParams => {
  return {
    info_list: {
      data_source_type: dataSourceType,
      notion_info_list: getNotionInfo(notionPages),
    },
    indexing_technique: indexingTechnique,
    process_rule: processRule,
    doc_form: docForm,
    doc_language: docLanguage,
    dataset_id,
  }
}

const getFileIndexingEstimateParamsForWeb = ({
  docForm,
  docLanguage,
  dataSourceType,
  websitePages,
  crawlOptions,
  websiteCrawlProvider,
  websiteCrawlJobId,
  indexingTechnique,
  processRule,
  dataset_id,
}: GetFileIndexingEstimateParamsOptionWeb): IndexingEstimateParams => {
  return {
    info_list: {
      data_source_type: dataSourceType,
      website_info_list: getWebsiteInfo({
        websiteCrawlProvider,
        websiteCrawlJobId,
        websitePages,
        crawlOptions,
      }),
    },
    indexing_technique: indexingTechnique,
    process_rule: processRule,
    doc_form: docForm,
    doc_language: docLanguage,
    dataset_id,
  }
}

export const useFetchFileIndexingEstimateForFile = (
  options: GetFileIndexingEstimateParamsOptionFile,
) => {
  return useMutation({
    mutationFn: async () => {
      return fetchFileIndexingEstimate(getFileIndexingEstimateParamsForFile(options))
    },
  })
}

export const useFetchFileIndexingEstimateForNotion = (
  options: GetFileIndexingEstimateParamsOptionNotion,
) => {
  return useMutation({
    mutationFn: async () => {
      return fetchFileIndexingEstimate(getFileIndexingEstimateParamsForNotion(options))
    },
  })
}

export const useFetchFileIndexingEstimateForWeb = (
  options: GetFileIndexingEstimateParamsOptionWeb,
) => {
  return useMutation({
    mutationFn: async () => {
      return fetchFileIndexingEstimate(getFileIndexingEstimateParamsForWeb(options))
    },
  })
}
