import type { IndexingType } from './hooks'
import type { DataSourceProvider, NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, createDocumentResponse, CustomFile, DataSourceType, FullDocumentDetail } from '@/models/datasets'
import type { RETRIEVE_METHOD } from '@/types/app'

export type StepTwoProps = {
  isSetting?: boolean
  documentDetail?: FullDocumentDetail
  isAPIKeySet: boolean
  onSetting: () => void
  datasetId?: string
  indexingType?: IndexingType
  retrievalMethod?: string
  dataSourceType: DataSourceType
  files: CustomFile[]
  notionPages?: NotionPage[]
  notionCredentialId: string
  websitePages?: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider?: DataSourceProvider
  websiteCrawlJobId?: string
  onStepChange?: (delta: number) => void
  updateIndexingTypeCache?: (type: string) => void
  updateRetrievalMethodCache?: (method: RETRIEVE_METHOD | '') => void
  updateResultCache?: (res: createDocumentResponse) => void
  onSave?: () => void
  onCancel?: () => void
}
