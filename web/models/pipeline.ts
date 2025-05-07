import type { ChunkingMode, IconInfo } from './datasets'

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
