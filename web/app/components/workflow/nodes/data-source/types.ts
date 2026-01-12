import type { Dispatch, SetStateAction } from 'react'
import type { ResourceVarInputs } from '../_base/types'
import type { CommonNodeType, Node } from '@/app/components/workflow/types'
import type { FlowType } from '@/types/common'
import type { NodeRunResult, VarInInspect } from '@/types/workflow'

export { VarKindType as VarType } from '../_base/types'

export enum DataSourceClassification {
  localFile = 'local_file',
  websiteCrawl = 'website_crawl',
  onlineDocument = 'online_document',
  onlineDrive = 'online_drive',
}

export type ToolVarInputs = ResourceVarInputs

export type DataSourceNodeType = CommonNodeType & {
  fileExtensions?: string[]
  plugin_id: string
  provider_type: string
  provider_name: string
  datasource_name: string
  datasource_label: string
  datasource_parameters: ToolVarInputs
  datasource_configurations: Record<string, any>
  plugin_unique_identifier?: string
}

export type CustomRunFormProps = {
  nodeId: string
  flowId: string
  flowType: FlowType
  payload: CommonNodeType
  setRunResult: Dispatch<SetStateAction<NodeRunResult | null>>
  setIsRunAfterSingleRun: Dispatch<SetStateAction<boolean>>
  isPaused: boolean
  isRunAfterSingleRun: boolean
  onSuccess: () => void
  onCancel: () => void
  appendNodeInspectVars: (nodeId: string, vars: VarInInspect[], nodes: Node[]) => void
}
