import groupBy from 'lodash-es/groupBy'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { CrawlOptions, CrawlResultItem, CustomFile, DocForm, IndexingEstimateParams, NotionInfo, ProcessRule } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
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

type GetFileIndexingEstimateParamsOption = {
  docForm: DocForm
  docLanguage: string
  dataSourceType: DataSourceType
  files: CustomFile[]
  indexingTechnique: IndexingType
  processRule: ProcessRule
  dataset_id: string
  notionPages?: NotionPage[]
  websitePages?: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider?: DataSourceProvider
  websiteCrawlJobId?: string
}

const getFileIndexingEstimateParams = ({
  docForm,
  docLanguage,
  dataSourceType,
  files,
  indexingTechnique,
  processRule,
  dataset_id,
  notionPages,
  websitePages,
  crawlOptions,
  websiteCrawlProvider,
  websiteCrawlJobId,
}: GetFileIndexingEstimateParamsOption): IndexingEstimateParams | undefined => {
  if (dataSourceType === DataSourceType.FILE) {
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
  if (dataSourceType === DataSourceType.NOTION) {
    return {
      info_list: {
        data_source_type: dataSourceType,
        notion_info_list: getNotionInfo(
          notionPages as NotionPage[],
        ),
      },
      indexing_technique: indexingTechnique,
      process_rule: processRule,
      doc_form: docForm,
      doc_language: docLanguage,
      dataset_id,
    }
  }
  if (dataSourceType === DataSourceType.WEB) {
    return {
      info_list: {
        data_source_type: dataSourceType,
        website_info_list: getWebsiteInfo({
          websiteCrawlProvider: websiteCrawlProvider as DataSourceProvider,
          websiteCrawlJobId: websiteCrawlJobId as string,
          websitePages: websitePages as CrawlResultItem[],
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
}

export const useFetchFileIndexingEstimate = () => {

}
