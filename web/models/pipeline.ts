import type { Viewport } from 'reactflow'
import type { DSLImportMode, DSLImportStatus } from './app'
import type { ChunkingMode, DatasetPermission, DocumentIndexingStatus, FileIndexingEstimateResponse, IconInfo } from './datasets'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { Dependency } from '@/app/components/plugins/types'
import type { Edge, EnvironmentVariable, Node, SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { TransferMethod } from '@/types/app'
import type { NodeRunResult } from '@/types/workflow'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'

export enum DatasourceType {
  localFile = 'local_file',
  onlineDocument = 'online_document',
  websiteCrawl = 'website_crawl',
  onlineDrive = 'online_drive',
}

export type PipelineTemplateListParams = {
  type: 'built-in' | 'customized'
  language?: string
}

export type PipelineTemplate = {
  id: string
  name: string
  icon: IconInfo
  description: string
  position: number
  chunk_structure: ChunkingMode
}

export type PipelineTemplateListResponse = {
  pipeline_templates: PipelineTemplate[]
}

export type PipelineTemplateByIdRequest = {
  template_id: string
  type: 'built-in' | 'customized'
}

export type PipelineTemplateByIdResponse = {
  id: string
  name: string
  icon_info: IconInfo
  description: string
  chunk_structure: ChunkingMode
  export_data: string // DSL content
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
  created_by: string
}

export type CreateFormData = {
  name: string
  appIcon: AppIconSelection
  description: string
  permission: DatasetPermission
  selectedMemberIDs: string[]
}

export type UpdateTemplateInfoRequest = {
  template_id: string
  name: string
  icon_info: IconInfo
  description: string
}

export type UpdateTemplateInfoResponse = {
  pipeline_id: string
  name: string
  icon: IconInfo
  description: string
  position: number
}

export type DeleteTemplateResponse = {
  code: number
}

export type ExportTemplateDSLResponse = {
  data: string
}

export type ImportPipelineDSLRequest = {
  mode: DSLImportMode
  yaml_content?: string
  yaml_url?: string
  pipeline_id?: string
}

export type ImportPipelineDSLResponse = {
  id: string
  status: DSLImportStatus
  pipeline_id: string
  dataset_id: string
  current_dsl_version: string
  imported_dsl_version: string
}

export type ImportPipelineDSLConfirmResponse = {
  status: DSLImportStatus
  pipeline_id: string
  dataset_id: string
  current_dsl_version: string
  imported_dsl_version: string
  error: string
}

export type PipelineCheckDependenciesResponse = {
  leaked_dependencies: Dependency[]
}

export enum PipelineInputVarType {
  textInput = 'text-input',
  paragraph = 'paragraph',
  select = 'select',
  number = 'number',
  singleFile = 'file',
  multiFiles = 'file-list',
  checkbox = 'checkbox',
}

export const VAR_TYPE_MAP: Record<PipelineInputVarType, BaseFieldType> = {
  [PipelineInputVarType.textInput]: BaseFieldType.textInput,
  [PipelineInputVarType.paragraph]: BaseFieldType.paragraph,
  [PipelineInputVarType.select]: BaseFieldType.select,
  [PipelineInputVarType.singleFile]: BaseFieldType.file,
  [PipelineInputVarType.multiFiles]: BaseFieldType.fileList,
  [PipelineInputVarType.number]: BaseFieldType.numberInput,
  [PipelineInputVarType.checkbox]: BaseFieldType.checkbox,
}

export type RAGPipelineVariable = {
  belong_to_node_id: string // indicates belong to which node or 'shared'
  type: PipelineInputVarType
  label: string
  variable: string
  max_length?: number
  default_value?: string
  placeholder?: string
  unit?: string
  required: boolean
  tooltips?: string
  options?: string[]
  allowed_file_upload_methods?: TransferMethod[]
  allowed_file_types?: SupportUploadFileTypes[]
  allowed_file_extensions?: string[]
}

export type InputVar = Omit<RAGPipelineVariable, 'belong_to_node_id'>
export type RAGPipelineVariables = RAGPipelineVariable[]

export type PipelineProcessingParamsRequest = {
  pipeline_id: string
  node_id: string
}

export type PipelineProcessingParamsResponse = {
  variables: RAGPipelineVariables
}

export type PipelinePreProcessingParamsRequest = {
  pipeline_id: string
  node_id: string
}

export type PipelinePreProcessingParamsResponse = {
  variables: RAGPipelineVariables
}

export type PublishedPipelineInfoResponse = {
  id: string
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
  created_at: number
  created_by: {
    id: string
    name: string
    email: string
  }
  hash: string
  updated_at: number
  updated_by: {
    id: string
    name: string
    email: string
  }
  environment_variables?: EnvironmentVariable[]
  rag_pipeline_variables?: RAGPipelineVariables
  version: string
  marked_name: string
  marked_comment: string
}

export type PublishedPipelineRunRequest = {
  pipeline_id: string
  inputs: Record<string, any>
  start_node_id: string
  datasource_type: DatasourceType
  datasource_info_list: Array<Record<string, any>>
  original_document_id?: string
  is_preview: boolean
}

export type PublishedPipelineRunPreviewResponse = {
  task_iod: string
  workflow_run_id: string
  data: {
    id: string
    status: string
    created_at: number
    elapsed_time: number
    error: string
    finished_at: number
    outputs: FileIndexingEstimateResponse
    total_steps: number
    total_tokens: number
    workflow_id: string
  }
}

export type PublishedPipelineRunResponse = {
  batch: string
  dataset: {
    chunk_structure: ChunkingMode
    description: string
    id: string
    name: string
  }
  documents: InitialDocumentDetail[]
}

export type InitialDocumentDetail = {
  data_source_info: Record<string, any>
  data_source_type: DatasourceType
  enable: boolean
  error: string
  id: string
  indexing_status: DocumentIndexingStatus
  name: string
  position: number
}

export type PipelineExecutionLogRequest = {
  dataset_id: string
  document_id: string
}

export type PipelineExecutionLogResponse = {
  datasource_info: Record<string, any>
  datasource_type: DatasourceType
  input_data: Record<string, any>
  datasource_node_id: string
}

export type OnlineDocumentPreviewRequest = {
  workspaceID: string
  pageID: string
  pageType: string
  pipelineId: string
  datasourceNodeId: string
  credentialId: string
}

export type OnlineDocumentPreviewResponse = {
  content: string
}

export type ConversionResponse = {
  pipeline_id: string
  dataset_id: string
  status: 'success' | 'failed'
}

export enum OnlineDriveFileType {
  file = 'file',
  folder = 'folder',
  bucket = 'bucket',
}

export type OnlineDriveFile = {
  id: string
  name: string
  size?: number
  type: OnlineDriveFileType
}

export type DatasourceNodeSingleRunRequest = {
  pipeline_id: string
  start_node_id: string
  start_node_title: string
  datasource_type: DatasourceType
  datasource_info: Record<string, any>
}

export type DatasourceNodeSingleRunResponse = NodeRunResult
