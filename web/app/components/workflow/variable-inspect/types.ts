export const EVENT_WORKFLOW_STOP = 'WORKFLOW_STOP'

export const CHUNK_SCHEMA_TYPES = ['general_structure', 'parent_child_structure', 'qa_structure']

export const ViewMode = {
  Code: 'code',
  Preview: 'preview',
} as const
export type ViewMode = typeof ViewMode[keyof typeof ViewMode]

export const PreviewType = {
  Markdown: 'markdown',
  Chunks: 'chunks',
} as const
export type PreviewType = typeof PreviewType[keyof typeof PreviewType]
