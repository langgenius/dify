import type {
  DatasetAndDocumentResponse,
  DocumentDetailResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { IndexingType } from './hooks'
import type { DataSourceProvider, NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, CustomFile, DataSourceType } from '@/models/datasets'
import type { RETRIEVE_METHOD } from '@/types/app'

/** The fields step two reads from a file to index; uploads and stored documents both provide them. */
export type StepTwoFile = Pick<CustomFile, 'id' | 'name' | 'extension'>

/** The fields step two reads from a Notion page to index. */
export type StepTwoNotionPage = Pick<
  NotionPage,
  'workspace_id' | 'page_id' | 'page_name' | 'page_icon' | 'type'
>

export type StepTwoProps = {
  isSetting?: boolean
  documentDetail?: DocumentDetailResponse
  isAPIKeySet: boolean
  onSetting: () => void
  datasetId?: string
  indexingType?: IndexingType
  retrievalMethod?: string
  dataSourceType: DataSourceType
  files: StepTwoFile[]
  notionPages?: StepTwoNotionPage[]
  notionCredentialId: string
  websitePages?: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider?: DataSourceProvider
  websiteCrawlJobId?: string
  canCreateDocument?: boolean
  onStepChange?: (delta: number) => void
  updateIndexingTypeCache?: (type: string) => void
  updateRetrievalMethodCache?: (method: RETRIEVE_METHOD | '') => void
  updateResultCache?: (res: DatasetAndDocumentResponse) => void
  onSave?: () => void
  onCancel?: () => void
}
