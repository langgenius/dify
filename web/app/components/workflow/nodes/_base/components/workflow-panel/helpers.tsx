import type { ReactNode } from 'react'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { CustomRunFormProps } from '@/app/components/workflow/nodes/data-source/types'
import type { Node, ToolWithProvider } from '@/app/components/workflow/types'
import DataSourceBeforeRunForm from '@/app/components/workflow/nodes/data-source/before-run-form'
import { DataSourceClassification } from '@/app/components/workflow/nodes/data-source/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { canFindTool } from '@/utils'

const MIN_NODE_PANEL_WIDTH = 400
const DEFAULT_MAX_NODE_PANEL_WIDTH = 720

export const getMaxNodePanelWidth = (workflowCanvasWidth?: number, otherPanelWidth?: number, reservedCanvasWidth = MIN_NODE_PANEL_WIDTH) => {
  if (!workflowCanvasWidth)
    return DEFAULT_MAX_NODE_PANEL_WIDTH

  const available = workflowCanvasWidth - (otherPanelWidth || 0) - reservedCanvasWidth
  return Math.max(available, MIN_NODE_PANEL_WIDTH)
}

export const clampNodePanelWidth = (width: number, maxNodePanelWidth: number) => {
  return Math.max(MIN_NODE_PANEL_WIDTH, Math.min(width, maxNodePanelWidth))
}

export const getCompressedNodePanelWidth = (nodePanelWidth: number, workflowCanvasWidth?: number, otherPanelWidth?: number, reservedCanvasWidth = MIN_NODE_PANEL_WIDTH) => {
  if (!workflowCanvasWidth)
    return undefined

  const total = nodePanelWidth + (otherPanelWidth || 0) + reservedCanvasWidth
  if (total <= workflowCanvasWidth)
    return undefined

  return clampNodePanelWidth(workflowCanvasWidth - (otherPanelWidth || 0) - reservedCanvasWidth, getMaxNodePanelWidth(workflowCanvasWidth, otherPanelWidth, reservedCanvasWidth))
}

export const getCustomRunForm = (params: CustomRunFormProps): ReactNode => {
  const nodeType = params.payload.type
  switch (nodeType) {
    case BlockEnum.DataSource:
      return <DataSourceBeforeRunForm {...params} />
    default:
      return null
  }
}

export const getCurrentToolCollection = (
  buildInTools: ToolWithProvider[] | undefined,
  storeBuildInTools: ToolWithProvider[] | undefined,
  providerId?: string,
) => {
  const candidates = buildInTools ?? storeBuildInTools
  return candidates?.find(item => canFindTool(item.id, providerId))
}

export const getCurrentDataSource = (
  data: Node['data'],
  dataSourceList: Array<{ plugin_id?: string, is_authorized?: boolean }> | undefined,
) => {
  if (data.type !== BlockEnum.DataSource || data.provider_type === DataSourceClassification.localFile)
    return undefined

  return dataSourceList?.find(item => item.plugin_id === data.plugin_id)
}

export const getCurrentTriggerPlugin = (
  data: Node['data'],
  triggerPlugins: TriggerWithProvider[] | undefined,
) => {
  if (data.type !== BlockEnum.TriggerPlugin || !data.plugin_id || !triggerPlugins?.length)
    return undefined

  return triggerPlugins.find(plugin => plugin.plugin_id === data.plugin_id)
}
