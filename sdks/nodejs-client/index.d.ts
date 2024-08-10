import type { ReadStream } from "fs";

// Types.d.ts
export const BASE_URL: string;

export type RequestMethods = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Params {
  [key: string]: any;
}

interface HeaderParams {
  [key: string]: string;
}

interface User {
}

export interface DifyApiError {
  code: string;
  status: number;
  message: string;
}

export declare class DifyClient {
  constructor(apiKey: string, baseUrl?: string);

  updateApiKey(apiKey: string): void;

  sendRequest(
    method: RequestMethods,
    endpoint: string,
    data?: any,
    params?: Params,
    stream?: boolean,
    headerParams?: HeaderParams
  ): Promise<any>;

  messageFeedback(message_id: string, rating: number, user: User): Promise<any>;

  getApplicationParameters(user: User): Promise<any>;

  fileUpload(data: FormData): Promise<any>;
}

export declare class CompletionClient extends DifyClient {
  createCompletionMessage(
    inputs: any,
    user: User,
    stream?: boolean,
    files?: File[] | null
  ): Promise<any>;
}

export declare class ChatClient extends DifyClient {
  createChatMessage(
    inputs: any,
    query: string,
    user: User,
    stream?: boolean,
    conversation_id?: string | null,
    files?: File[] | null
  ): Promise<any>;

  getConversationMessages(
    user: User,
    conversation_id?: string,
    first_id?: string | null,
    limit?: number | null
  ): Promise<any>;

  getConversations(user: User, first_id?: string | null, limit?: number | null, pinned?: boolean | null): Promise<any>;

  renameConversation(conversation_id: string, name: string, user: User): Promise<any>;

  deleteConversation(conversation_id: string, user: User): Promise<any>;
}

export interface PaginationParams {
  page?: number;
  /** Number of items returned, default 20, range 1-100
   * @default 20
   */
  limit?: number;
}

export interface PaginationResponse<T> {
  data: T[];
  has_more: boolean;
  limit: number;
  total: number;
  page: number;
}

// --- Dataset ---
export type DatasetIndexingTechnique = 'high_quality' | 'economy';
export type DatasetPermission = 'only_me' | 'all_team_members' | 'partial_members';
export type DatasetProcessRuleMode = 'automatic' | 'custom';
export type DatasetProcessRule =
  | { mode: 'automatic' }
  | {
    mode: 'custom';
    pre_processing_rules?: Array<{
      /**
       *  Unique identifier for the preprocessing rule.
       * - `remove_extra_spaces`: Replace consecutive spaces, newlines, tabs
       * - `remove_urls_emails`: Remove URLs and emails
       */
      id: 'remove_extra_spaces' | 'remove_urls_emails';
      enabled: boolean;
    }>;
    /** Segmentation rules */
    segmentation?: {
      /**
       * Custom segment identifier, currently only allows one delimiter to be set. Default is `\n`
       * @default '\n'
       */
      separator?: string;
      /**
       *  Maximum length (tokens). Defaults to 1000.
       * @default 1000
       */
      max_tokens?: number;
    }
  };
export interface DatasetRetrievalModel {
  search_method: 'hybrid_search' | 'semantic_search' | 'full_text_search';
  /** Whether reranking mode is enabled. */
  reranking_enable: boolean;
  /** Reranking mode. */
  reranking_mode: 'reranking_model' | null;
  /**
   * Rerank model will reorder the candidate document list
   * based on the semantic match with user query,
   * improving the results of semantic ranking
   */
  reranking_model: {
    reranking_provider_name: string | null;
    reranking_model_name: string | null;
  }
  weights: {
    keyword_setting: {
      /**
       * Weight of keyword matching in the final score.
       * Should be in the range of `[0, 1]`, and the sum of `keyword_weight` and `vector_weight` should be 1.
       */
      keyword_weight: number;
    };
    vector_setting: {
      /**
       * Weight of vector matching in the final score.
       * Should be in the range of `[0, 1]`, and the sum of `keyword_weight` and `vector_weight` should be 1.
       */
      vector_weight: number;
      embedding_model_name: string;
      embedding_model_provider: string;
    }
  } | null;
  /** 
   * Used to filter chunks that are most similar to user questions.
   * The system will also dynamically adjust the value of Top K,
   * according to max_tokens of the selected model.
   */
  top_k: number;
  /** Used to set the similarity threshold for chunks filtering. */
  score_threshold_enabled: boolean;
  score_threshold: number;
}

export interface Dataset {
  /** UUID identifier of this dataset. */
  id: string;
  name: string;
  description: string | null;
  provider: 'vendor'
  permission: DatasetPermission;
  data_source_type: 'upload_file' | 'notion_import' | 'website_crawl' | null;
  /**
   * Index mode.
   * - `high_quality`: embedding using embedding model, built as vector database index
   * - `economy`: Build using inverted index of Keyword Table Index
   */
  indexing_technique: DatasetIndexingTechnique | null;
  app_count: number;
  document_count: number;
  word_count: number;
  /** Creator's UUID */
  created_by: string;
  /** Timestamp when this dataset is created. */
  created_at: number;
  /** UUID of the user who last updated this dataset. Defaults to the creator's UUID. */
  updated_by: string;
  /** Timestamp when this dataset is last updated. Defaults to `created_at`. */
  updated_at: number;
  embedding_model: string | null;
  embedding_model_provider: string | null;
  embedding_available: boolean;
  retrieval_model_dict: DatasetRetrievalModel;
  tags: string[];
}

// --- DatasetDocument ---
export interface DatasetDocumentDataSource_UploadFile {
  data_source_type: 'upload_file';
  data_source_info: {
    upload_file_id: string;
  }
  data_source_detail_dict: {
    upload_file: {
      id: string;
      name: string;
      size: number;
      extension: string;
      mime_type: string;
      created_by: string;
      created_at: number;
    }
  }
}

export interface DatasetDocumentDataSource_WebsiteCrawl {
  data_source_type: 'website_crawl';
  data_source_info: {
    url: string;
    provider: 'firecrawl';
    job_id: string;
    only_main_content: boolean;
    mode: 'scrape' | 'crawl';
  }
  data_source_detail_dict: {
    website_crawl: {
      id: string;
      url: string;
      created_by: string;
      created_at: number;
    }
  }
}

// TODO: Add Notion import type

export type DatasetDocumentDataSource = DatasetDocumentDataSource_UploadFile | DatasetDocumentDataSource_WebsiteCrawl;
export type DatasetDocumentIndexingStatus = 'waiting' | 'indexing' | 'completed' | 'error' | 'paused' | 'splitting' | 'parsing';
export type DatasetDocumentDocumentForm = 'text_model' | 'qa_model';

export type DatasetDocument = DatasetDocumentDataSource & {
  id: string;
  position: number;
  data_source_type: 'upload_file' // TODO: add other types
  dataset_process_rule_id: string;
  name: string;
  created_from: 'web' | 'api';
  created_by: string;
  created_at: number;
  tokens: number;
  indexing_status: DatasetDocumentIndexingStatus;
  error: string | null;
  enabled: boolean;
  disabled_at: number | null;
  disabled_by: string | null;
  archived: boolean;
  display_status: 'queuing' | 'paused' | 'indexing' | 'error' | 'available' | 'disabled' | 'archived';
  word_count: number;
  hit_count: number;
  doc_form: DatasetDocumentDocumentForm;
}

// --- Create Document ---
export interface CreateDocumentByTextOptions {
  name: string;
  text: string;
  indexing_technique?: DatasetIndexingTechnique;
  process_rule?: DatasetProcessRule;
  /**
   * Document segmenting format.
   * Available options:
   * - Text model: Normal segmenting strategy
   * - Q&A model: Segment in Question & Answer format. Note: this will consume more tokens.
  */
  doc_form?: DatasetDocumentDocumentForm;
  /** 
   * Doc language, e.g. `Chinese Simplified`. For available options, please refer to Dify UI for now.
   * Only requied when `doc_form` is `qa_model`.
   */
  doc_language?: string;
}

export interface CreateDocumentByFileOptions {
  /**
   * Source document ID.
   * - Used to re-upload the document or modify the document cleaning and segmentation configuration. The missing information is copied from the source document
   * - The source document cannot be an archived document
   * - When original_document_id is passed in, the update operation is performed on behalf of the document. process_rule is a fillable item. If not filled in, the segmentation method of the source document will be used by defaul
   * - When original_document_id is not passed in, the new operation is performed on behalf of the document, and process_rule is required
  */
  original_document_id?: string;
  indexing_technique?: DatasetIndexingTechnique;
  process_rule?: DatasetProcessRule;
  /**
   * File to be uploaded. Can be a `ReadStream` (returned by `fs.createReadStream()`) or a filename string.
  */
  file: ReadStream | string;
  /**
   * Document segmenting format.
   * Available options:
   * - Text model: Normal segmenting strategy
   * - Q&A model: Segment in Question & Answer format. Note: this will consume more tokens.
  */
  doc_form?: DatasetDocumentDocumentForm;
  /** 
   * Doc language, e.g. `Chinese Simplified`. For available options, please refer to Dify UI for now.
   * Only requied when `doc_form` is `qa_model`.
   */
  doc_language?: string;
}
export interface CreateDocumentReturn {
  document: DatasetDocument;
  batch: string;
}

// --- DatasetDocument embedding status ---
export interface DatasetDocumentEmbeddingStatus {
  id: string;
  indexing_status: DatasetDocumentIndexingStatus;
  processing_started_at: number | null;
  parsing_completed_at: number | null;
  cleaning_completed_at: number | null;
  splitting_completed_at: number | null;
  completed_at: number | null;
  paused_at: number | null;
  error: string | null;
  stopped_at: number | null;
  completed_segments: number;
  total_segments: number;
}

// --- Segment ---
export interface DocumentSegmentData {
  id: string;
  position: number;
  document_id: string;
  content: string;
  answer: string | null;
  word_count: number;
  tokens: number;
  keywords: string[];
  index_node_id: string;
  index_node_hash: string;
  hit_count: number;
  enabled: boolean;
  disabled_at: number | null;
  disabled_by: string | null;
  status: 'waiting' | 'processing' | 'completed' | 'error'
  created_by: string;
  created_at: number;
  indexing_at: number | null;
  completed_at: number | null;
  error: string | null;
  stopped_at: number | null;
}
export interface DocumentSegments {
  data: DocumentSegmentData[];
  doc_form: DatasetDocumentDocumentForm;
}

// --- Add segment ---
export interface AddSegmentOptions {
  segments: Array<{
    /** Text content/question content */
    content: string;
    /** Answer content, if the mode of the Knowledge is Q&A mode, pass the value */
    answer?: string;
    /** Keywords */
    keywords?: string[];
  }>;
}

// --- Update segment ---
export interface UpdateSegmentOptions {
  /** Text content/question content */
  content: string;
  /** Answer content, if the mode of the Knowledge is Q&A mode, pass the value */
  answer?: string;
  /** Keywords */
  keywords?: string[];
  enabled?: boolean;
}

// --- DatasetClient ---
export declare class DatasetClient extends DifyClient {
  /**
   * Create an empty Knowledge.
   * @throws {DifyApiError}
   */
  createDataset(name: string): Promise<Dataset>;

  /**
   * Query the Knowledge list.
   * @throws {DifyApiError}
   */
  listDatasets(params: PaginationParams): Promise<PaginationResponse<Dataset>>;

  /** 
   * Delete a Knowledge.
   * @throws {DifyApiError}
   */
  deleteDataset(dataset_id: string): Promise<void>;

  /**
   * Create a document from text.
   * This api is based on an existing Knowledge and creates a new document through text based on this Knowledge.
   * @throws {DifyApiError}
   */
  createDocumentByText(dataset_id: string, options: CreateDocumentByTextOptions): Promise<CreateDocumentReturn>;

  /**
   * Create documents from files
   * @throws {DifyApiError}
   */
  createDocumentByFile(dataset_id: string, options: CreateDocumentByFileOptions): Promise<CreateDocumentReturn>;

  /**
   * Update document via text.
   * This api is based on an existing Knowledge and updates the document through text based on this Knowledge.
   * @throws {DifyApiError}
   */
  updateDocumentByText(
    dataset_id: string,
    document_id: string,
    options: Partial<CreateDocumentByTextOptions>
  ): Promise<CreateDocumentReturn>;

  /**
   * Update document from a file.
   * This api is based on an existing Knowledge and updates the document through a file based on this Knowledge.
   * @throws {DifyApiError}
   */
  updateDocumentByFile(
    dataset_id: string,
    document_id: string,
    options: Partial<CreateDocumentByFileOptions> & { name?: string }
  ): Promise<CreateDocumentReturn>;

  /**
   * Get document embedding status (progress)
   * @throws {DifyApiError}
   */
  getDocumentEmbeddingStatus(
    dataset_id: string,
    /** Batch number of uploaded documents */
    batch: string
  ): Promise<Array<DatasetDocumentEmbeddingStatus>>;

  /**
   * Delete document
   * @throws {DifyApiError}
   */
  deleteDocument(dataset_id: string, document_id: string): Promise<void>;

  /**
   * Get Knowledge document list
   * @throws {DifyApiError}
   */
  listDocuments(dataset_id: string, params: PaginationParams): Promise<PaginationResponse<DatasetDocument>>;

  /**
   * Add segment
   * @throws {DifyApiError}
   */
  addSegment(dataset_id: string, document_id: string, options: AddSegmentOptions): Promise<DocumentSegments>;

  /** 
   * Get document segments
   * @throws {DifyApiError}
   */
  getDocumentSegments(dataset_id: string, document_id: string, params: PaginationParams): Promise<DocumentSegments>;

  /**
   * Delete document segment
   * @throws {DifyApiError}
   */
  deleteDocumentSegment(dataset_id: string, document_id: string, segment_id: string): Promise<void>;

  /**
   * Update document segment
   * @throws {DifyApiError}
   */
  updateDocumentSegment(
    dataset_id: string,
    document_id: string,
    segment_id: string,
    options: UpdateSegmentOptions
  ): Promise<DocumentSegments>;
}
