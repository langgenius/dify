import type { IndexingEstimatePayload } from '@dify/contracts/api/console/datasets/types.gen'
import type { IndexingType } from './hooks/use-indexing-config'
import type { StepTwoFile, StepTwoNotionPage } from './types'
import type { DataSourceProvider } from '@/models/common'
import type {
  ChunkingMode,
  CrawlOptions,
  CrawlResultItem,
  DataSourceType,
  NotionInfo,
  ProcessRule,
} from '@/models/datasets'
import { groupBy } from 'es-toolkit/compat'

export const getNotionInfo = (
  notionPages: StepTwoNotionPage[],
  credentialId: string,
): NotionInfo[] => {
  const workspacesMap = groupBy(notionPages, 'workspace_id')
  const workspaces = Object.keys(workspacesMap).map((workspaceId) => {
    return {
      workspaceId,
      pages: workspacesMap[workspaceId],
    }
  })
  return workspaces.map((workspace) => {
    return {
      credential_id: credentialId,
      workspace_id: workspace.workspaceId,
      pages: workspace.pages!.map((page) => {
        const { page_id, page_name, page_icon, type } = page
        return {
          page_id,
          page_name,
          // The backend requires an icon type; an icon without one carries nothing to render.
          page_icon: page_icon?.type ? { ...page_icon, type: page_icon.type } : null,
          type,
        }
      }),
    }
  })
}

export const getWebsiteInfo = (opts: {
  websiteCrawlProvider: DataSourceProvider
  websiteCrawlJobId: string
  websitePages: CrawlResultItem[]
  crawlOptions?: CrawlOptions
}) => {
  const { websiteCrawlProvider, websiteCrawlJobId, websitePages, crawlOptions } = opts
  return {
    provider: websiteCrawlProvider,
    job_id: websiteCrawlJobId,
    urls: websitePages.map((page) => page.source_url),
    only_main_content: crawlOptions?.only_main_content,
  }
}

type GetFileIndexingEstimateParamsOptionBase = {
  docForm: ChunkingMode
  docLanguage: string
  indexingTechnique: IndexingType
  processRule: ProcessRule
  dataset_id: string
}

type GetFileIndexingEstimateParamsOptionFile = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: typeof DataSourceType.FILE
  files: StepTwoFile[]
}

export const getFileIndexingEstimateParamsForFile = ({
  docForm,
  docLanguage,
  dataSourceType,
  files,
  indexingTechnique,
  processRule,
  dataset_id,
}: GetFileIndexingEstimateParamsOptionFile): IndexingEstimatePayload => {
  const fileIds = files.map((file) => file.id).filter((id): id is string => Boolean(id))

  return {
    info_list: {
      data_source_type: dataSourceType,
      file_info_list: {
        file_ids: fileIds,
      },
    },
    indexing_technique: indexingTechnique,
    process_rule: processRule,
    doc_form: docForm,
    doc_language: docLanguage,
    dataset_id,
  }
}

type GetFileIndexingEstimateParamsOptionNotion = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: typeof DataSourceType.NOTION
  notionPages: StepTwoNotionPage[]
  credential_id: string
}

export const getFileIndexingEstimateParamsForNotion = ({
  docForm,
  docLanguage,
  dataSourceType,
  notionPages,
  indexingTechnique,
  processRule,
  dataset_id,
  credential_id,
}: GetFileIndexingEstimateParamsOptionNotion): IndexingEstimatePayload => {
  return {
    info_list: {
      data_source_type: dataSourceType,
      notion_info_list: getNotionInfo(notionPages, credential_id),
    },
    indexing_technique: indexingTechnique,
    process_rule: processRule,
    doc_form: docForm,
    doc_language: docLanguage,
    dataset_id,
  }
}

type GetFileIndexingEstimateParamsOptionWeb = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: typeof DataSourceType.WEB
  websitePages: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider: DataSourceProvider
  websiteCrawlJobId: string
}

export const getFileIndexingEstimateParamsForWeb = ({
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
}: GetFileIndexingEstimateParamsOptionWeb): IndexingEstimatePayload => {
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
