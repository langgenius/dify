import type { InputVar, InputVarType } from '@/app/components/workflow/types'
import type { DSLImportMode, DSLImportStatus } from './app'
import type { ChunkingMode, DatasetPermission, IconInfo } from './datasets'
import type { Dependency } from '@/app/components/plugins/types'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'

export type PipelineTemplateListParams = {
  type: 'built-in' | 'customized'
}

export type PipelineTemplate = {
  id: string
  name: string
  icon_info: IconInfo
  description: string
  position: number
  doc_form: ChunkingMode
}

export type PipelineTemplateListResponse = {
  pipelines: PipelineTemplate[]
}

export type PipelineTemplateByIdResponse = {
  name: string
  icon_info: IconInfo
  description: string
  author: string // todo: TBD
  structure: string // todo: TBD
  export_data: string
}

export type CreateFormData = {
  name: string
  appIcon: AppIconSelection
  description: string
  permission: DatasetPermission
  selectedMemberIDs: string[]
}

export type UpdatePipelineInfoRequest = {
  pipeline_id: string
  name: string
  icon_info: IconInfo
  description: string
}

export type UpdatePipelineInfoResponse = {
  pipeline_id: string
  name: string
  icon_info: IconInfo
  description: string
  position: number
}

export type DeletePipelineResponse = {
  code: number
}

export type ExportPipelineDSLRequest = {
  pipeline_id: string
  include_secret?: boolean
}

export type ExportPipelineDSLResponse = {
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
  error: string
  leaked_dependencies: Dependency[]
}

export type ImportPipelineDSLConfirmRequest = {
  import_id: string
}

export type ImportPipelineDSLConfirmResponse = {
  id: string
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

export type Variables = {
  type: InputVarType
  label: string
  description: string
  variable: string
  max_length: number
  required: boolean
  options?: string[]
  default: string | number | boolean
}

export type PipelineProcessingParamsResponse = {
  variables: Variables[]
}

export type RAGPipelineVariable = InputVar

export type RAGPipelineVariables = Array<{
  nodeId: string
  variables: RAGPipelineVariable[]
}>
