export type DatasetListOptions = {
  page?: number;
  limit?: number;
  keyword?: string | null;
  tagIds?: string[];
  includeAll?: boolean;
};

export type DatasetCreateRequest = {
  name: string;
  description?: string;
  indexing_technique?: "high_quality" | "economy";
  permission?: string | null;
  external_knowledge_api_id?: string | null;
  provider?: string;
  external_knowledge_id?: string | null;
  retrieval_model?: Record<string, unknown> | null;
  embedding_model?: string | null;
  embedding_model_provider?: string | null;
};

export type DatasetUpdateRequest = {
  name?: string;
  description?: string | null;
  indexing_technique?: "high_quality" | "economy" | null;
  permission?: string | null;
  embedding_model?: string | null;
  embedding_model_provider?: string | null;
  retrieval_model?: Record<string, unknown> | null;
  partial_member_list?: Array<Record<string, string>> | null;
  external_retrieval_model?: Record<string, unknown> | null;
  external_knowledge_id?: string | null;
  external_knowledge_api_id?: string | null;
};

export type DocumentStatusAction = "enable" | "disable" | "archive" | "un_archive";

export type DatasetTagCreateRequest = {
  name: string;
};

export type DatasetTagUpdateRequest = {
  tag_id: string;
  name: string;
};

export type DatasetTagDeleteRequest = {
  tag_id: string;
};

export type DatasetTagBindingRequest = {
  tag_ids: string[];
  target_id: string;
};

export type DatasetTagUnbindingRequest = {
  tag_id: string;
  target_id: string;
};

export type DocumentTextCreateRequest = {
  name: string;
  text: string;
  process_rule?: Record<string, unknown> | null;
  original_document_id?: string | null;
  doc_form?: string;
  doc_language?: string;
  indexing_technique?: string | null;
  retrieval_model?: Record<string, unknown> | null;
  embedding_model?: string | null;
  embedding_model_provider?: string | null;
};

export type DocumentTextUpdateRequest = {
  name?: string | null;
  text?: string | null;
  process_rule?: Record<string, unknown> | null;
  doc_form?: string;
  doc_language?: string;
  retrieval_model?: Record<string, unknown> | null;
};

export type DocumentListOptions = {
  page?: number;
  limit?: number;
  keyword?: string | null;
  status?: string | null;
};

export type DocumentGetOptions = {
  metadata?: "all" | "only" | "without";
};

export type SegmentCreateRequest = {
  segments: Array<Record<string, unknown>>;
};

export type SegmentUpdateRequest = {
  segment: {
    content?: string | null;
    answer?: string | null;
    keywords?: string[] | null;
    regenerate_child_chunks?: boolean;
    enabled?: boolean | null;
    attachment_ids?: string[] | null;
  };
};

export type SegmentListOptions = {
  page?: number;
  limit?: number;
  status?: string[];
  keyword?: string | null;
};

export type ChildChunkCreateRequest = {
  content: string;
};

export type ChildChunkUpdateRequest = {
  content: string;
};

export type ChildChunkListOptions = {
  page?: number;
  limit?: number;
  keyword?: string | null;
};

export type MetadataCreateRequest = {
  type: "string" | "number" | "time";
  name: string;
};

export type MetadataUpdateRequest = {
  name: string;
  value?: string | number | null;
};

export type DocumentMetadataDetail = {
  id: string;
  name: string;
  value?: string | number | null;
};

export type DocumentMetadataOperation = {
  document_id: string;
  metadata_list: DocumentMetadataDetail[];
  partial_update?: boolean;
};

export type MetadataOperationRequest = {
  operation_data: DocumentMetadataOperation[];
};

export type HitTestingRequest = {
  query?: string | null;
  retrieval_model?: Record<string, unknown> | null;
  external_retrieval_model?: Record<string, unknown> | null;
  attachment_ids?: string[] | null;
};

export type DatasourcePluginListOptions = {
  isPublished?: boolean;
};

export type DatasourceNodeRunRequest = {
  inputs: Record<string, unknown>;
  datasource_type: string;
  credential_id?: string | null;
  is_published: boolean;
};

export type PipelineRunRequest = {
  inputs: Record<string, unknown>;
  datasource_type: string;
  datasource_info_list: Array<Record<string, unknown>>;
  start_node_id: string;
  is_published: boolean;
  response_mode: "streaming" | "blocking";
};

export type KnowledgeBaseResponse = Record<string, unknown>;
export type PipelineStreamEvent = Record<string, unknown>;
