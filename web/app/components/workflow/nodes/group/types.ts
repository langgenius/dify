import type { BlockEnum, CommonNodeType } from '../../types'

export type GroupMember = {
  id: string
  type: BlockEnum
  label?: string
}

export type GroupHandler = {
  id: string
  label?: string
}

export type GroupNodeData = CommonNodeType<{
  members?: GroupMember[]
  handlers?: GroupHandler[]
}>
