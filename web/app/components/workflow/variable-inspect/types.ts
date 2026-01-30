import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { PromptTemplateItem } from '@/app/components/workflow/types'
import type { FileResponse } from '@/types/workflow'

export const EVENT_WORKFLOW_STOP = 'WORKFLOW_STOP'

export const CHUNK_SCHEMA_TYPES = ['general_structure', 'parent_child_structure', 'qa_structure']

export enum ViewMode {
  Code = 'code',
  Preview = 'preview',
}

export enum PreviewType {
  Markdown = 'markdown',
  Chunks = 'chunks',
}

export enum InspectTab {
  Variables = 'variables',
  Artifacts = 'artifacts',
}

export type VarInspectValue
  = string
    | number
    | boolean
    | null
    | Record<string, unknown>
    | Array<string | number | boolean | null | Record<string, unknown>>
    | FileEntity
    | FileEntity[]
    | FileResponse
    | FileResponse[]
    | PromptTemplateItem[]
