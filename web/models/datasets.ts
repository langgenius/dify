import type {
  ChildChunkListResponse,
  ChildChunkResponse,
  ConsoleSegmentListResponse,
  DocumentDetailResponse as ContractDocumentDetailResponse,
  ErrorDocsResponse as ContractErrorDocsResponse,
  ProcessRuleResponse as ContractProcessRuleResponse,
  RelatedAppResponse as ContractRelatedAppResponse,
  DatasetDetailWithPartialMembersResponse,
  DatasetDocMetadataResponse,
  DatasetListResponse,
  DatasetQueryContentResponse,
  DatasetQueryDetailResponse,
  DocumentStatusListResponse,
  DocumentStatusResponse,
  DocumentWithSegmentsListResponse,
  DocumentWithSegmentsResponse,
  ExternalHitTestingRecordResponse,
  ExternalHitTestingResponse,
  HitTestingChildChunk as GeneratedHitTestingChildChunk,
  HitTestingResponse as GeneratedHitTestingResponse,
  HitTestingRecord as HitTestingRecordResponse,
  NotionInfo as NotionInfoPayload,
  PreProcessingRule as PreProcessingRulePayload,
  RelatedAppListResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { DataSourceNotionPage, DataSourceProvider } from './common'
import type { DatasourceType } from './pipeline'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { AppIconType, RetrievalConfig, TransferMethod } from '@/types/app'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { PermissionLevel } from './permission'

export const DataSourceType = {
  FILE: 'upload_file',
  NOTION: 'notion_import',
  WEB: 'website_crawl',
} as const

export type DataSourceType = (typeof DataSourceType)[keyof typeof DataSourceType]

// Re-export PermissionLevel as DatasetPermission for backward compatibility
export const DatasetPermission = PermissionLevel

export type DatasetPermission = PermissionLevel

export const ChunkingMode = {
  text: 'text_model', // General text
  qa: 'qa_model', // General QA
  parentChild: 'hierarchical_model', // Parent-Child
  // graph = 'graph', // todo: Graph RAG
} as const

export type ChunkingMode = (typeof ChunkingMode)[keyof typeof ChunkingMode]

export type MetadataInDoc = DatasetDocMetadataResponse

export type IconInfo = {
  icon: string
  icon_background?: string
  icon_type: AppIconType
  icon_url?: string
}

export type SummaryIndexSetting = {
  enable?: boolean
  model_name?: string
  model_provider_name?: string
  summary_prompt?: string
}

export type DataSet = DatasetDetailWithPartialMembersResponse

export type ExternalAPIItem = {
  id: string
  tenant_id: string
  name: string
  description: string
  settings: {
    endpoint: string
    api_key: string
  }
  dataset_bindings: { id: string; name: string }[]
  created_by: string
  created_at: string
}

export type ExternalKnowledgeItem = {
  id: string
  name: string
  description: string | null
  provider: 'external'
  permission: DatasetPermission
  data_source_type: null
  indexing_technique: null
  app_count: number
  document_count: number
  word_count: number
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
  tags: Tag[]
}

export type ExternalAPIUsage = {
  is_using: boolean
  count: number
}

export type CustomFile = File & {
  id?: string
  extension?: string
  mime_type?: string
  created_by?: string
  created_at?: number
}

export type DocumentItem = {
  id: string
  name: string
  extension: string
}

export type CrawlOptions = {
  crawl_sub_pages: boolean
  only_main_content: boolean
  includes: string
  excludes: string
  limit: number | string
  max_depth: number | string
  use_sitemap: boolean
}

export type CrawlResultItem = {
  title: string
  markdown: string
  description: string
  source_url: string
}

export type CrawlResult = {
  data: CrawlResultItem[]
  time_consuming: number | string
}

export const CrawlStep = {
  init: 'init',
  running: 'running',
  finished: 'finished',
} as const

export type CrawlStep = (typeof CrawlStep)[keyof typeof CrawlStep]

export type FileItem = {
  fileID: string
  file: CustomFile
  progress: number
}

export type FetchDatasetsParams = {
  params: {
    page: number
    ids?: string[]
    tag_ids?: string[]
    limit?: number
    include_all?: boolean
    keyword?: string
  }
}

export type DataSetListResponse = DatasetListResponse

export type QA = {
  question: string
  answer: string
}

type IndexingEstimateResponse = {
  tokens: number
  total_price: number
  currency: string
  total_segments: number
  preview: Array<{ content: string; child_chunks: string[]; summary?: string }>
  qa_preview?: QA[]
}

export type FileIndexingEstimateResponse = {
  total_nodes: number
} & IndexingEstimateResponse

export type IndexingStatusResponse = DocumentStatusResponse
export type IndexingStatusBatchResponse = DocumentStatusListResponse

export const ProcessMode = {
  general: 'custom',
  parentChild: 'hierarchical',
} as const

export type ProcessMode = (typeof ProcessMode)[keyof typeof ProcessMode]

export type ParentMode = 'full-doc' | 'paragraph'

export type ProcessRuleResponse = ContractProcessRuleResponse

export type Rules = {
  pre_processing_rules: PreProcessingRule[]
  segmentation: Segmentation
  parent_mode?: ParentMode
  subchunk_segmentation?: Segmentation
}

export type PreProcessingRule = PreProcessingRulePayload

type Segmentation = {
  separator: string
  max_tokens: number
  chunk_overlap?: number
}

export type DocumentIndexingStatus =
  | 'waiting'
  | 'parsing'
  | 'cleaning'
  | 'splitting'
  | 'indexing'
  | 'paused'
  | 'error'
  | 'completed'

export const DisplayStatusList = [
  'queuing',
  'indexing',
  'paused',
  'error',
  'available',
  'enabled',
  'disabled',
  'archived',
] as const

export type DocumentDisplayStatus = (typeof DisplayStatusList)[number]

export const isDocumentDisplayStatus = (value: unknown): value is DocumentDisplayStatus =>
  DisplayStatusList.some((status) => status === value)

export type LegacyDataSourceInfo = {
  upload_file: {
    id: string
    name: string
    size: number
    mime_type: string
    created_at: number
    created_by: string
    extension: string
  }
  notion_page_icon?: string
  notion_workspace_id?: string
  notion_page_id?: string
  provider?: DataSourceProvider
  job_id: string
  url: string
  credential_id?: string
}

export type LocalFileInfo = {
  extension: string
  mime_type: string
  name: string
  related_id: string
  size: number
  transfer_method: TransferMethod
  url: string
}

export type WebsiteCrawlInfo = {
  content: string
  credential_id: string
  description: string
  source_url: string
  title: string
  provider?: string
  job_id?: string
}

export type OnlineDocumentInfo = {
  credential_id: string
  workspace_id: string
  page: {
    last_edited_time: string
    page_icon: DataSourceNotionPage['page_icon']
    page_id: string
    page_name: string
    parent_id: string
    type: string
  }
}

export type UploadFileIdInfo = {
  upload_file_id: string
}

export type DataSourceInfo =
  | LegacyDataSourceInfo
  | LocalFileInfo
  | OnlineDocumentInfo
  | WebsiteCrawlInfo
  | UploadFileIdInfo

export type InitialDocumentDetail = {
  id: string
  batch: string
  position: number
  dataset_id: string
  data_source_type: DataSourceType | DatasourceType
  data_source_info: DataSourceInfo
  dataset_process_rule_id: string
  name: string
  created_from: 'rag-pipeline' | 'api' | 'web'
  created_by: string
  created_at: number
  indexing_status: DocumentIndexingStatus
  display_status: DocumentDisplayStatus
  completed_segments?: number
  total_segments?: number
  doc_form: ChunkingMode
  doc_language: string
  summary_index_status?: string
}

// A document in the dataset document list.
export type SimpleDocumentDetail = DocumentWithSegmentsResponse

export type DocumentListResponse = DocumentWithSegmentsListResponse

type DocumentReq = {
  original_document_id?: string
  indexing_technique?: IndexingType
  doc_form: ChunkingMode
  doc_language: string
  process_rule: ProcessRule
  summary_index_setting?: SummaryIndexSetting
}

export type CreateDocumentReq = Omit<DocumentReq, 'indexing_technique'> & {
  indexing_technique: IndexingType
  data_source: DataSource
  retrieval_model: RetrievalConfig
  embedding_model: string
  embedding_model_provider: string
}

type DataSource = {
  type: DataSourceType
  info_list: {
    data_source_type: DataSourceType
    notion_info_list?: NotionInfo[]
    file_info_list?: {
      file_ids: string[]
    }
    website_info_list?: {
      provider: string
      job_id: string
      urls: string[]
    }
  }
}

export type NotionInfo = NotionInfoPayload

export type ProcessRule = {
  mode: ProcessMode
  rules: Rules
  summary_index_setting?: SummaryIndexSetting
}

export type createDocumentResponse = {
  dataset?: DataSet
  batch: string
  documents: InitialDocumentDetail[]
}

// A dataset document as the document detail query returns it.
export type FullDocumentDetail = ContractDocumentDetailResponse

type CustomizableDocType =
  | 'book'
  | 'web_page'
  | 'paper'
  | 'social_media_post'
  | 'personal_document'
  | 'business_document'
  | 'im_chat_log'
type FixedDocType = 'synced_from_github' | 'synced_from_notion' | 'wikipedia_entry'
export type DocType = CustomizableDocType | FixedDocType

export type Attachment = {
  id: string
  name: string
  size: number
  extension: string
  mime_type: string
  source_url: string
}

export type SegmentDetailModel = SegmentResponse

export type SegmentsResponse = ConsoleSegmentListResponse

export type Query = DatasetQueryContentResponse

export type HitTestingRecord = DatasetQueryDetailResponse

export type RelatedApp = ContractRelatedAppResponse

export type RelatedAppResponse = RelatedAppListResponse

export type SegmentUpdater = {
  content: string
  answer?: string
  summary?: string
  keywords?: string[]
  regenerate_child_chunks?: boolean
  attachment_ids?: string[]
}

export type ErrorDocsResponse = ContractErrorDocsResponse

export type SelectedDatasetsMode = {
  allHighQuality: boolean
  allHighQualityVectorSearch: boolean
  allHighQualityFullTextSearch: boolean
  allEconomic: boolean
  mixtureHighQualityAndEconomic: boolean
  allInternal: boolean
  allExternal: boolean
  mixtureInternalAndExternal: boolean
  inconsistentEmbeddingModel: boolean
}

export const WeightedScoreEnum = {
  SemanticFirst: 'semantic_first',
  KeywordFirst: 'keyword_first',
  Customized: 'customized',
} as const

export type WeightedScoreEnum = (typeof WeightedScoreEnum)[keyof typeof WeightedScoreEnum]

export const RerankingModeEnum = {
  RerankingModel: 'reranking_model',
  WeightedScore: 'weighted_score',
} as const

export type RerankingModeEnum = (typeof RerankingModeEnum)[keyof typeof RerankingModeEnum]

export const DEFAULT_WEIGHTED_SCORE = {
  allHighQualityVectorSearch: {
    semantic: 1.0,
    keyword: 0,
  },
  allHighQualityFullTextSearch: {
    semantic: 0,
    keyword: 1.0,
  },
  other: {
    semantic: 0.7,
    keyword: 0.3,
  },
}

export type ChildChunkDetail = ChildChunkResponse

export type ChildSegmentsResponse = ChildChunkListResponse

// Used in api url
export const DocumentActionType = {
  enable: 'enable',
  disable: 'disable',
  archive: 'archive',
  unArchive: 'un_archive',
  delete: 'delete',
  summary: 'summary',
} as const

export type DocumentActionType = (typeof DocumentActionType)[keyof typeof DocumentActionType]

export const DOC_FORM_ICON_CLASS_WITH_BG: Record<ChunkingMode | 'external', string> = {
  [ChunkingMode.text]: 'i-custom-public-knowledge-dataset-card-general',
  [ChunkingMode.qa]: 'i-custom-public-knowledge-dataset-card-qa',
  [ChunkingMode.parentChild]: 'i-custom-public-knowledge-dataset-card-parent-child',
  // [ChunkingMode.graph]: Graph, // todo: Graph RAG
  external: 'i-custom-public-knowledge-dataset-card-external-knowledge-base',
}

type ChunkingModeText = I18nKeysByPrefix<'dataset', 'chunkingMode.'>

export const DOC_FORM_TEXT: Record<ChunkingMode, ChunkingModeText> = {
  [ChunkingMode.text]: 'general',
  [ChunkingMode.qa]: 'qa',
  [ChunkingMode.parentChild]: 'parentChild',
  // [ChunkingMode.graph]: 'graph', // todo: Graph RAG
}

export type HitTestingRequest = {
  query: string
  attachment_ids: string[]
  retrieval_model: RetrievalConfig
}

export type ExternalKnowledgeBaseHitTestingRequest = {
  query: string
  external_retrieval_model: {
    top_k: number
    score_threshold: number
    score_threshold_enabled: boolean
  }
}

export type HitTestingChildChunk = GeneratedHitTestingChildChunk
export type HitTesting = HitTestingRecordResponse
export type HitTestingResponse = GeneratedHitTestingResponse
export type ExternalKnowledgeBaseHitTesting = ExternalHitTestingRecordResponse
export type ExternalKnowledgeBaseHitTestingResponse = ExternalHitTestingResponse
