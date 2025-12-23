import type { BlockEnum, CommonNodeType } from '../../types'

export type GroupMember = {
  id: string
  type: BlockEnum
  label?: string
}

export type GroupHandler = {
  id: string
  label?: string
  nodeId?: string // leaf node id for multi-branch nodes
  sourceHandle?: string // original sourceHandle (e.g., case_id for if-else)
}

export type GroupNodeData = CommonNodeType<{
  members?: GroupMember[]
  handlers?: GroupHandler[]
}>
