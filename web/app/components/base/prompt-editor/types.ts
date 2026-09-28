import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { GeneratorType } from '../../app/configuration/config/automatic/types'
import type { FormInputItem } from '../../workflow/nodes/human-input/types'
import type { Type } from '../../workflow/nodes/llm/types'
import type { AgentOutputTypeOptionValue } from './plugins/agent-output-block/utils'
import type { Dataset } from './plugins/context-block'
import type { RoleName } from './plugins/history-block'
import type { RosterReferenceToken } from './plugins/roster-reference-block/utils'
import type { Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'

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

export type RequestURLBlockType = {
  show?: boolean
  selectable?: boolean
  onInsert?: () => void
  onDelete?: () => void
}

export type VariableBlockType = {
  show?: boolean
  variables?: Option[]
}

export type RosterReferenceBlockType = {
  show?: boolean
  renderIcon?: (token: RosterReferenceToken) => React.ReactNode
  getWarning?: (token: RosterReferenceToken) => string | undefined
}

export type ExternalToolBlockType = {
  show?: boolean
  externalTools?: ExternalToolOption[]
  onAddExternalTool?: () => void
}

export type GetVarType = (payload: { nodeId: string; valueSelector: ValueSelector }) => Type

export type WorkflowVariableBlockType = {
  show?: boolean
  variables?: NodeOutPutVar[]
  workflowNodesMap?: WorkflowNodesMap
  onInsert?: () => void
  onDelete?: () => void
  getVarType?: GetVarType
  showManageInputField?: boolean
  onManageInputField?: () => void
}

export type AgentOutputBlockType = {
  show?: boolean
  outputs?: DeclaredOutputConfig[]
  onChange?: (outputs: DeclaredOutputConfig[], prompt?: string) => void
  onEdit?: (name: string, outputType: AgentOutputTypeOptionValue) => void
}

export type WorkflowNodesMap = Record<
  string,
  Pick<Node['data'], 'title' | 'type' | 'height' | 'width' | 'position'> & {
    modelProvider?: string
  }
>

export type HITLInputBlockType = {
  show?: boolean
  nodeId: string
  formInputs?: FormInputItem[]
  variables?: NodeOutPutVar[]
  workflowNodesMap?: WorkflowNodesMap
  getVarType?: GetVarType
  onFormInputsChange?: (inputs: FormInputItem[]) => void
  onFormInputItemRemove: (varName: string) => void
  onFormInputItemRename: (payload: FormInputItem, oldName: string) => void
  onInsert?: () => void
  onDelete?: () => void
  readonly?: boolean
}

export type MenuTextMatch = {
  leadOffset: number
  matchingString: string
  replaceableString: string
}

export type CurrentBlockType = {
  show?: boolean
  generatorType: GeneratorType
  onInsert?: () => void
  onDelete?: () => void
}

export type ErrorMessageBlockType = {
  show?: boolean
  onInsert?: () => void
  onDelete?: () => void
}

export type LastRunBlockType = {
  show?: boolean
  onInsert?: () => void
  onDelete?: () => void
}
