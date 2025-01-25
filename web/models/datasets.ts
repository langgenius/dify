import type { DataSourceNotionPage, DataSourceProvider } from './common'
import type { AppIconType, AppMode, RetrievalConfig } from '@/types/app'
import type { Tag } from '@/app/components/base/tag-management/constant'
import type { IndexingType } from '@/app/components/datasets/create/step-two'

export enum DataSourceType {
  FILE = 'upload_file',
  NOTION = 'notion_import',
  WEB = 'website_crawl',
}

export type DatasetPermission = 'only_me' | 'all_team_members' | 'partial_members'

export enum ChunkingMode {
  'text' = 'text_model', // General text
  'qa' = 'qa_model', // General QA
  'parentChild' = 'hierarchical_model', // Parent-Child
}

export type DataSet = {
  id: string
  name: string
  icon: string
  icon_background: string
  description: string
  permission: DatasetPermission
  data_source_type: DataSourceType
  indexing_technique: IndexingType
  created_by: string
  updated_by: string
  updated_at: number
  app_count: number
  doc_form: ChunkingMode
  document_count: number
  word_count: number
  provider: string
  embedding_model: string
  embedding_model_provider: string
  embedding_available: boolean
  retrieval_model_dict: RetrievalConfig
  retrieval_model: RetrievalConfig
  tags: Tag[]
  partial_member_list?: any[]
  external_knowledge_info: {
    external_knowledge_id: string
    external_knowledge_api_id: string
    external_knowledge_api_name: string
    external_knowledge_api_endpoint: string
  }
  external_retrieval_model: {
    top_k: number
    score_threshold: number
    score_threshold_enabled: boolean
  }
}

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

export type ExternalAPIDeleteResponse = {
  result: 'success' | 'error'
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

export type FileItem = {
  fileID: string
  file: CustomFile
  progress: number
}

export type FetchDatasetsParams = {
  url: string
  params: {
    page: number
    tag_ids?: string[]
    limit: number
    include_all: boolean
    keyword?: string
  }
}

export type DataSetListResponse = {
  data: DataSet[]
  has_more: boolean
  limit: number
  page: number
  total: number
}

export type ExternalAPIListResponse = {
  data: ExternalAPIItem[]
  has_more: boolean
  limit: number
  page: number
  total: number
}

export type QA = {
  question: string
  answer: string
}

export type IndexingEstimateResponse = {
  tokens: number
  total_price: number
  currency: string
  total_segments: number
  preview: Array<{ content: string; child_chunks: string[] }>
  qa_preview?: QA[]
}

export type FileIndexingEstimateResponse = {
  total_nodes: number
} & IndexingEstimateResponse

export type IndexingStatusResponse = {
  id: string
  indexing_status: DocumentIndexingStatus
  processing_started_at: number
  parsing_completed_at: number
  cleaning_completed_at: number
  splitting_completed_at: number
  completed_at: any
  paused_at: any
  error: any
  stopped_at: any
  completed_segments: number
  total_segments: number
}
export type IndexingStatusBatchResponse = {
  data: IndexingStatusResponse[]
}

export enum ProcessMode {
  general = 'custom',
  parentChild = 'hierarchical',
}

export type ParentMode = 'full-doc' | 'paragraph'

export type ProcessRuleResponse = {
  mode: ProcessMode
  rules: Rules
  limits: Limits
}

export type Rules = {
  pre_processing_rules: PreProcessingRule[]
  segmentation: Segmentation
  parent_mode: ParentMode
  subchunk_segmentation: Segmentation
}

export type Limits = {
  indexing_max_segmentation_tokens_length: number
}

export type PreProcessingRule = {
  id: string
  enabled: boolean
}

export type Segmentation = {
  separator: string
  max_tokens: number
  chunk_overlap?: number
}

export const DocumentIndexingStatusList = [
  'waiting',
  'parsing',
  'cleaning',
  'splitting',
  'indexing',
  'paused',
  'error',
  'completed',
] as const

export type DocumentIndexingStatus = typeof DocumentIndexingStatusList[number]

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

export type DocumentDisplayStatus = typeof DisplayStatusList[number]

export type DataSourceInfo = {
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
}

export type InitialDocumentDetail = {
  id: string
  batch: string
  position: number
  dataset_id: string
  data_source_type: DataSourceType
  data_source_info: DataSourceInfo
  dataset_process_rule_id: string
  name: string
  created_from: 'api' | 'web'
  created_by: string
  created_at: number
  indexing_status: DocumentIndexingStatus
  display_status: DocumentDisplayStatus
  completed_segments?: number
  total_segments?: number
  doc_form: ChunkingMode
  doc_language: string
}

export type SimpleDocumentDetail = InitialDocumentDetail & {
  enabled: boolean
  word_count: number
  is_qa: boolean // TODO waiting for backend to add this field
  error?: string | null
  archived: boolean
  updated_at: number
  hit_count: number
  dataset_process_rule_id?: string
  data_source_detail_dict?: {
    upload_file: {
      name: string
      extension: string
    }
  }
}

export type DocumentListResponse = {
  data: SimpleDocumentDetail[]
  has_more: boolean
  total: number
  page: number
  limit: number
}

export type DocumentReq = {
  original_document_id?: string
  indexing_technique?: string
  doc_form: ChunkingMode
  doc_language: string
  process_rule: ProcessRule
}

export type CreateDocumentReq = DocumentReq & {
  data_source: DataSource
  retrieval_model: RetrievalConfig
  embedding_model: string
  embedding_model_provider: string
}

export type IndexingEstimateParams = DocumentReq & Partial<DataSource> & {
  dataset_id: string
}

export type DataSource = {
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

export type NotionInfo = {
  workspace_id: string
  pages: DataSourceNotionPage[]
}
export type NotionPage = {
  page_id: string
  type: string
}

export type ProcessRule = {
  mode: ProcessMode
  rules: Rules
}

export type createDocumentResponse = {
  dataset?: DataSet
  batch: string
  documents: InitialDocumentDetail[]
}

export type PrecessRule = {
  mode: ProcessMode
  rules: Rules
}

export type FullDocumentDetail = SimpleDocumentDetail & {
  batch: string
  created_api_request_id: string
  processing_started_at: number
  parsing_completed_at: number
  cleaning_completed_at: number
  splitting_completed_at: number
  tokens: number
  indexing_latency: number
  completed_at: number
  paused_by: string
  paused_at: number
  stopped_at: number
  indexing_status: string
  disabled_at: number
  disabled_by: string
  archived_reason: 'rule_modified' | 're_upload'
  archived_by: string
  archived_at: number
  doc_type?: DocType | null | 'others'
  doc_metadata?: DocMetadata | null
  segment_count: number
  dataset_process_rule: PrecessRule
  document_process_rule: ProcessRule
  [key: string]: any
}

export type DocMetadata = {
  title: string
  language: string
  author: string
  publisher: string
  publicationDate: string
  ISBN: string
  category: string
  [key: string]: string
}

export const CUSTOMIZABLE_DOC_TYPES = [
  'book',
  'web_page',
  'paper',
  'social_media_post',
  'personal_document',
  'business_document',
  'im_chat_log',
] as const

export const FIXED_DOC_TYPES = ['synced_from_github', 'synced_from_notion', 'wikipedia_entry'] as const

export type CustomizableDocType = typeof CUSTOMIZABLE_DOC_TYPES[number]
export type FixedDocType = typeof FIXED_DOC_TYPES[number]
export type DocType = CustomizableDocType | FixedDocType

export type DocumentDetailResponse = FullDocumentDetail

export const SEGMENT_STATUS_LIST = ['waiting', 'completed', 'error', 'indexing']
export type SegmentStatus = typeof SEGMENT_STATUS_LIST[number]

export type SegmentsQuery = {
  page?: string
  limit: number
  // status?: SegmentStatus
  hit_count_gte?: number
  keyword?: string
  enabled?: boolean | 'all'
}

export type SegmentDetailModel = {
  id: string
  position: number
  document_id: string
  content: string
  word_count: number
  tokens: number
  keywords: string[]
  index_node_id: string
  index_node_hash: string
  hit_count: number
  enabled: boolean
  disabled_at: number
  disabled_by: string
  status: SegmentStatus
  created_by: string
  created_at: number
  indexing_at: number
  completed_at: number
  error: string | null
  stopped_at: number
  answer?: string
  child_chunks?: ChildChunkDetail[]
  updated_at: number
}

export type SegmentsResponse = {
  data: SegmentDetailModel[]
  has_more: boolean
  limit: number
  total: number
  total_pages: number
  page: number
}

export type HitTestingRecord = {
  id: string
  content: string
  source: 'app' | 'hit_testing' | 'plugin'
  source_app_id: string
  created_by_role: 'account' | 'end_user'
  created_by: string
  created_at: number
}

export type HitTestingChildChunk = {
  id: string
  content: string
  position: number
  score: number
}
export type HitTesting = {
  segment: Segment
  content: Segment
  score: number
  tsne_position: TsnePosition
  child_chunks?: HitTestingChildChunk[] | null
}

export type ExternalKnowledgeBaseHitTesting = {
  content: string
  title: string
  score: number
  metadata: {
    'x-amz-bedrock-kb-source-uri': string
    'x-amz-bedrock-kb-data-source-id': string
  }
}

export type Segment = {
  id: string
  document: Document
  content: string
  position: number
  word_count: number
  tokens: number
  keywords: string[]
  hit_count: number
  index_node_hash: string
}

export type Document = {
  id: string
  data_source_type: string
  name: string
  doc_type: DocType
}

export type HitTestingRecordsResponse = {
  data: HitTestingRecord[]
  has_more: boolean
  limit: number
  total: number
  page: number
}

export type TsnePosition = {
  x: number
  y: number
}

export type HitTestingResponse = {
  query: {
    content: string
    tsne_position: TsnePosition
  }
  records: Array<HitTesting>
}

export type ExternalKnowledgeBaseHitTestingResponse = {
  query: {
    content: string
  }
  records: Array<ExternalKnowledgeBaseHitTesting>
}

export type RelatedApp = {
  id: string
  name: string
  mode: AppMode
  icon_type: AppIconType | null
  icon: string
  icon_background: string
  icon_url: string
}

export type RelatedAppResponse = {
  data: Array<RelatedApp>
  total: number
}

export type SegmentUpdater = {
  content: string
  answer?: string
  keywords?: string[]
  regenerate_child_chunks?: boolean
}

export type ErrorDocsResponse = {
  data: IndexingStatusResponse[]
  total: number
}

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

export enum WeightedScoreEnum {
  SemanticFirst = 'semantic_first',
  KeywordFirst = 'keyword_first',
  Customized = 'customized',
}

export enum RerankingModeEnum {
  RerankingModel = 'reranking_model',
  WeightedScore = 'weighted_score',
}

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

export type ChildChunkType = 'automatic' | 'customized'

export type ChildChunkDetail = {
  id: string
  position: number
  segment_id: string
  content: string
  word_count: number
  created_at: number
  updated_at: number
  type: ChildChunkType
}

export type ChildSegmentsResponse = {
  data: ChildChunkDetail[]
  total: number
  total_pages: number
  page: number
  limit: number
}

export type UpdateDocumentParams = {
  datasetId: string
  documentId: string
}

// Used in api url
export enum DocumentActionType {
  enable = 'enable',
  disable = 'disable',
  archive = 'archive',
  unArchive = 'un_archive',
  delete = 'delete',
}

export type UpdateDocumentBatchParams = {
  datasetId: string
  documentId?: string
  documentIds?: string[] | string
}

export type BatchImportResponse = {
  job_id: string
  job_status: string
}
