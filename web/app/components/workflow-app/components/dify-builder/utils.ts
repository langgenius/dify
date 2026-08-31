import { BlockEnum, isTriggerNode } from '@/app/components/workflow/types'

export type DifyBuilderCanvasNode = {
  data?: {
    type?: BlockEnum
  }
}

export const shouldStartBuildSession = (nodes: DifyBuilderCanvasNode[], edgeCount: number) => {
  if (edgeCount > 0) return false

  return nodes.every((node) => {
    const type = node.data?.type
    return (
      !type ||
      type === BlockEnum.Start ||
      type === BlockEnum.StartPlaceholder ||
      isTriggerNode(type)
    )
  })
}
