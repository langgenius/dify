import type { NodeProps } from '@/app/components/workflow/types'
import { BlockEnum, isTriggerNode, NodeRunningStatus } from '@/app/components/workflow/types'

export const getNodeStatusBorders = (
  runningStatus: NodeRunningStatus | undefined,
  hasVarValue: boolean,
  showSelectedBorder: boolean,
) => {
  return {
    showRunningBorder: (runningStatus === NodeRunningStatus.Running || runningStatus === NodeRunningStatus.Paused) && !showSelectedBorder,
    showSuccessBorder: (runningStatus === NodeRunningStatus.Succeeded || (hasVarValue && !runningStatus)) && !showSelectedBorder,
    showFailedBorder: runningStatus === NodeRunningStatus.Failed && !showSelectedBorder,
    showExceptionBorder: runningStatus === NodeRunningStatus.Exception && !showSelectedBorder,
  }
}

export const getLoopIndexTextKey = (runningStatus: NodeRunningStatus | undefined) => {
  if (runningStatus === NodeRunningStatus.Running)
    return 'nodes.loop.currentLoopCount'
  if (runningStatus === NodeRunningStatus.Succeeded || runningStatus === NodeRunningStatus.Failed)
    return 'nodes.loop.totalLoopCount'

  return undefined
}

export const isEntryWorkflowNode = (type: NodeProps['data']['type']) => {
  return isTriggerNode(type) || type === BlockEnum.Start
}

export const isContainerNode = (type: NodeProps['data']['type']) => {
  return type === BlockEnum.Iteration || type === BlockEnum.Loop
}
