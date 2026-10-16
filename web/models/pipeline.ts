import type {
  PipelineDocument,
  PipelineGenerateResponse,
} from '@dify/contracts/api/console/rag/types.gen'
import type { Viewport } from 'reactflow'
import type { ChunkingMode, IconInfo } from './datasets'
import type { Edge, Node, SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { TransferMethod } from '@/types/app'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'

export const DatasourceType = {
  localFile: 'local_file',
  onlineDocument: 'online_document',
  websiteCrawl: 'website_crawl',
  onlineDrive: 'online_drive',
} as const

export type DatasourceType = (typeof DatasourceType)[keyof typeof DatasourceType]

export type PipelineTemplate = {
  id: string
  name: string
  icon: IconInfo
  description: string
  position: number
  chunk_structure: ChunkingMode
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

export const PipelineInputVarType = {
  textInput: 'text-input',
  paragraph: 'paragraph',
  select: 'select',
  number: 'number',
  singleFile: 'file',
  multiFiles: 'file-list',
  checkbox: 'checkbox',
} as const

export type PipelineInputVarType = (typeof PipelineInputVarType)[keyof typeof PipelineInputVarType]

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
  default_value?: string | number | boolean
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

export type PublishedPipelineRunResponse = PipelineGenerateResponse

export type InitialDocumentDetail = PipelineDocument

export type PipelineExecutionLogResponse = {
  datasource_info: Record<string, any>
  datasource_type: DatasourceType
  input_data: Record<string, any>
  datasource_node_id: string
}

export const OnlineDriveFileType = {
  file: 'file',
  folder: 'folder',
  bucket: 'bucket',
} as const

export type OnlineDriveFileType = (typeof OnlineDriveFileType)[keyof typeof OnlineDriveFileType]

export type OnlineDriveFile = {
  id: string
  name: string
  size?: number
  type: OnlineDriveFileType
}
