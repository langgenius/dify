import type { DataSourceNotionPage } from './common'
import type { AppMode, RetrievalConfig } from '@/types/app'
import type { Tag } from '@/app/components/base/tag-management/constant'

export enum DataSourceType {
  FILE = 'upload_file',
  NOTION = 'notion_import',
  WEB = 'web_import',
}

export type DataSet = {
  id: string
  name: string
  icon: string
  icon_background: string
  description: string
  permission: 'only_me' | 'all_team_members'
  data_source_type: DataSourceType
  indexing_technique: 'high_quality' | 'economy'
  created_by: string
  updated_by: string
  updated_at: number
  app_count: number
  document_count: number
  word_count: number
  embedding_model: string
  embedding_model_provider: string
  embedding_available: boolean
  retrieval_model_dict: RetrievalConfig
  retrieval_model: RetrievalConfig
  tags: Tag[]
}

export type CustomFile = File & {
  id?: string
  extension?: string
  mime_type?: string
  created_by?: string
  created_at?: number
}

export type FileItem = {
  fileID: string
  file: CustomFile
  progress: number
}

export type DataSetListResponse = {
  data: DataSet[]
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
  preview: string[]
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

export type ProcessMode = 'automatic' | 'custom'

export type ProcessRuleResponse = {
  mode: ProcessMode
  rules: Rules
}

export type Rules = {
  pre_processing_rules: PreProcessingRule[]
  segmentation: Segmentation
}

export type PreProcessingRule = {
  id: string
  enabled: boolean
}

export type Segmentation = {
  separator: string
  max_tokens: number
  chunk_overlap: number
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
  doc_form: 'text_model' | 'qa_model'
}

export type SimpleDocumentDetail = InitialDocumentDetail & {
  enabled: boolean
  word_count: number
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
  doc_form: 'text_model' | 'qa_model'
  doc_language: string
  process_rule: ProcessRule
}

export type CreateDocumentReq = DocumentReq & {
  data_source: DataSource
  retrieval_model: RetrievalConfig
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
  mode: string
  rules: Rules
}

export type createDocumentResponse = {
  dataset?: DataSet
  batch: string
  documents: InitialDocumentDetail[]
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
  last_id?: string
  limit: number
  // status?: SegmentStatus
  hit_count_gte?: number
  keyword?: string
  enabled?: boolean
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
}

export type SegmentsResponse = {
  data: SegmentDetailModel[]
  has_more: boolean
  limit: number
  total: number
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

export type HitTesting = {
  segment: Segment
  score: number
  tsne_position: TsnePosition
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

export type RelatedApp = {
  id: string
  name: string
  mode: AppMode
  icon: string
  icon_background: string
}

export type RelatedAppResponse = {
  data: Array<RelatedApp>
  total: number
}

export type SegmentUpdator = {
  content: string
  answer?: string
  keywords?: string[]
}

export enum DocForm {
  TEXT = 'text_model',
  QA = 'qa_model',
}

export type ErrorDocsResponse = {
  data: IndexingStatusResponse[]
  total: number
}
