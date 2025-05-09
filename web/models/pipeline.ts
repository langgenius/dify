import type { InputVarType } from '@/app/components/workflow/types'
import type { DSLImportMode, DSLImportStatus } from './app'
import type { ChunkingMode, IconInfo } from './datasets'
import type { Dependency } from '@/app/components/plugins/types'

export type PipelineTemplateListParams = {
  type: 'built-in' | 'customized'
}

export type PipelineTemple = {
  id: string
  name: string
  icon_info: IconInfo
  description: string
  position: number
  doc_form: ChunkingMode
}

export type PipelineTemplateListResponse = {
  pipelines: PipelineTemple[]
}

export type PipelineTemplateByIdResponse = {
  name: string
  icon_info: IconInfo
  description: string
  author: string // todo: TBD
  structure: string // todo: TBD
  export_data: string
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

export type ExportPipelineDSLResponse = {
  data: string
}

export type ImportPipelineDSLRequest = {
  mode: DSLImportMode
  name: string
  yaml_content: string
  icon_info: IconInfo
  description: string
}

export type ImportPipelineDSLResponse = {
  id: string
  status: DSLImportStatus
  app_mode: 'pipeline'
  dataset_id?: string
  current_dsl_version?: string
  imported_dsl_version?: string
  error: string
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
