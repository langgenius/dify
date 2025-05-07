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

export type UpdatePipelineInfoPayload = {
  pipelineId: string
  name: string
  icon_info: IconInfo
  description: string
}

export type ExportPipelineDSLResponse = {
  data: string
}
