import type { ReactNode } from 'react'
import type { NodeProps } from '../types'
import type { VarInInspect } from '@/types/workflow'

/* eslint-disable ts/no-redeclare -- const + type share names (erasable enum replacement) */
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

export const InspectTab = {
  Variables: 'variables',
  Artifacts: 'artifacts',
} as const
export type InspectTab = typeof InspectTab[keyof typeof InspectTab]

export type InspectHeaderProps = {
  activeTab: InspectTab
  headerActions?: ReactNode
  onClose: () => void
  onTabChange: (tab: InspectTab) => void
}

export type CurrentVarInInspect = {
  nodeId: string
  nodeType: string
  title: string
  isValueFetched?: boolean
  var?: VarInInspect
  nodeData?: NodeProps['data']
}
