import type { Dataset } from './plugins/context-block'
import type { RoleName } from './plugins/history-block'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'

export type Option = {
  value: string
  name: string
}

export type ExternalToolOption = {
  name: string
  variableName: string
  icon?: string
  icon_background?: string
}

export type ContextBlockType = {
  show?: boolean
  selectable?: boolean
  datasets?: Dataset[]
  canNotAddContext?: boolean
  onAddContext?: () => void
  onInsert?: () => void
  onDelete?: () => void
}

export type QueryBlockType = {
  show?: boolean
  selectable?: boolean
  onInsert?: () => void
  onDelete?: () => void
}

export type HistoryBlockType = {
  show?: boolean
  selectable?: boolean
  history?: RoleName
  onInsert?: () => void
  onDelete?: () => void
  onEditRole?: () => void
}

export type VariableBlockType = {
  show?: boolean
  variables?: Option[]
}

export type ExternalToolBlockType = {
  show?: boolean
  externalTools?: ExternalToolOption[]
  onAddExternalTool?: () => void
}

export type WorkflowVariableBlockType = {
  show?: boolean
  variables?: NodeOutPutVar[]
  workflowNodesMap?: Record<string, Pick<Node['data'], 'title' | 'type' | 'height' | 'width' | 'position'>>
  onInsert?: () => void
  onDelete?: () => void
}

export type MenuTextMatch = {
  leadOffset: number
  matchingString: string
  replaceableString: string
}
