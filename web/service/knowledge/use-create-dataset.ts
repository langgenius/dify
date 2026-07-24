import type { MutationOptions } from '@tanstack/react-query'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { DataSourceProvider, NotionPage } from '@/models/common'
import type {
  ChunkingMode,
  CrawlOptions,
  CrawlResultItem,
  CreateDatasetReq,
  CreateDatasetResponse,
  CreateDocumentReq,
  createDocumentResponse,
  CustomFile,
  DataSourceType,
  FileIndexingEstimateResponse,
  IndexingEstimateParams,
  NotionInfo,
  ProcessRule,
  ProcessRuleResponse,
} from '@/models/datasets'
import { useMutation } from '@tanstack/react-query'
import { groupBy } from 'es-toolkit/compat'
import { post } from '../base'
import { createDocument, createFirstDocument, fetchDefaultProcessRule, fetchFileIndexingEstimate } from '../datasets'

const NAME_SPACE = 'knowledge/create-dataset'

export const getNotionInfo = (
  notionPages: NotionPage[],
  credentialId: string,
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
      credential_id: credentialId,
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

export const getWebsiteInfo = (
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
  docForm: ChunkingMode
  docLanguage: string
  indexingTechnique: IndexingType
  processRule: ProcessRule
  dataset_id: string
}

type GetFileIndexingEstimateParamsOptionFile = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: DataSourceType.FILE
  files: CustomFile[]
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

export const useFetchFileIndexingEstimateForFile = (
  options: GetFileIndexingEstimateParamsOptionFile,
  mutationOptions: MutationOptions<FileIndexingEstimateResponse> = {},
) => {
  return useMutation({
    mutationFn: async () => {
      return fetchFileIndexingEstimate(getFileIndexingEstimateParamsForFile(options))
    },
    ...mutationOptions,
  })
}

type GetFileIndexingEstimateParamsOptionNotion = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: DataSourceType.NOTION
  notionPages: NotionPage[]
  credential_id: string
}

const getFileIndexingEstimateParamsForNotion = ({
  docForm,
  docLanguage,
  dataSourceType,
  notionPages,
  indexingTechnique,
  processRule,
  dataset_id,
  credential_id,
}: GetFileIndexingEstimateParamsOptionNotion): IndexingEstimateParams => {
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

export const useFetchFileIndexingEstimateForNotion = (
  options: GetFileIndexingEstimateParamsOptionNotion,
  mutationOptions: MutationOptions<FileIndexingEstimateResponse> = {},
) => {
  return useMutation({
    mutationFn: async () => {
      return fetchFileIndexingEstimate(getFileIndexingEstimateParamsForNotion(options))
    },
    ...mutationOptions,
  })
}

type GetFileIndexingEstimateParamsOptionWeb = GetFileIndexingEstimateParamsOptionBase & {
  dataSourceType: DataSourceType.WEB
  websitePages: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider: DataSourceProvider
  websiteCrawlJobId: string
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

export const useFetchFileIndexingEstimateForWeb = (
  options: GetFileIndexingEstimateParamsOptionWeb,
  mutationOptions: MutationOptions<FileIndexingEstimateResponse> = {},
) => {
  return useMutation({
    mutationFn: async () => {
      return fetchFileIndexingEstimate(getFileIndexingEstimateParamsForWeb(options))
    },
    ...mutationOptions,
  })
}

export const useCreateFirstDocument = (
  mutationOptions: MutationOptions<createDocumentResponse, Error, CreateDocumentReq> = {},
) => {
  return useMutation({
    mutationFn: async (createDocumentReq: CreateDocumentReq,
    ) => {
      return createFirstDocument({ body: createDocumentReq })
    },
    ...mutationOptions,
  })
}

export const useCreateDocument = (
  datasetId: string,
  mutationOptions: MutationOptions<createDocumentResponse, Error, CreateDocumentReq> = {},
) => {
  return useMutation({
    mutationFn: async (req: CreateDocumentReq) => {
      return createDocument({ datasetId, body: req })
    },
    ...mutationOptions,
  })
}

export const useFetchDefaultProcessRule = (
  mutationOptions: MutationOptions<ProcessRuleResponse, Error, string> = {},
) => {
  return useMutation({
    mutationFn: async (url: string) => {
      return fetchDefaultProcessRule({ url })
    },
    ...mutationOptions,
  })
}

export const useCreatePipelineDataset = (
  mutationOptions: MutationOptions<CreateDatasetResponse, Error> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'create-pipeline-empty-dataset'],
    mutationFn: () => {
      return post<CreateDatasetResponse>('/rag/pipeline/empty-dataset')
    },
    ...mutationOptions,
  })
}

export const useCreatePipelineDatasetFromCustomized = (
  mutationOptions: MutationOptions<CreateDatasetResponse, Error, CreateDatasetReq> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'create-pipeline-dataset'],
    mutationFn: (req: CreateDatasetReq) => {
      return post<CreateDatasetResponse>('/rag/pipeline/dataset', { body: req })
    },
    ...mutationOptions,
  })
}
