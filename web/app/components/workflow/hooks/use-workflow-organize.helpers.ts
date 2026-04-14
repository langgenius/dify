import type { Node } from '../types'
import type { LayoutResult } from '../utils/elk-layout'
import { produce } from 'immer'
import {
  CUSTOM_NODE,
  NODE_LAYOUT_HORIZONTAL_PADDING,
  NODE_LAYOUT_VERTICAL_PADDING,
} from '../constants'
import { BlockEnum } from '../types'

type ContainerSizeChange = {
  width: number
  height: number
}

type LayerInfo = {
  minY: number
  maxHeight: number
}

export const getLayoutContainerNodes = (nodes: Node[]) => {
  return nodes.filter(
    node => (node.data.type === BlockEnum.Loop || node.data.type === BlockEnum.Iteration)
      && !node.parentId
      && node.type === CUSTOM_NODE,
  )
}

export const getContainerSizeChanges = (
  parentNodes: Node[],
  childLayoutsMap: Record<string, LayoutResult>,
) => {
  return parentNodes.reduce<Record<string, ContainerSizeChange>>((acc, parentNode) => {
    const childLayout = childLayoutsMap[parentNode.id]
    if (!childLayout || !childLayout.nodes.size)
      return acc

    const requiredWidth = (childLayout.bounds.maxX - childLayout.bounds.minX) + NODE_LAYOUT_HORIZONTAL_PADDING * 2
    const requiredHeight = (childLayout.bounds.maxY - childLayout.bounds.minY) + NODE_LAYOUT_VERTICAL_PADDING * 2

    acc[parentNode.id] = {
      width: Math.max(parentNode.width || 0, requiredWidth),
      height: Math.max(parentNode.height || 0, requiredHeight),
    }
    return acc
  }, {})
}

export const applyContainerSizeChanges = (
  nodes: Node[],
  containerSizeChanges: Record<string, ContainerSizeChange>,
) => produce(nodes, (draft) => {
  draft.forEach((node) => {
    const nextSize = containerSizeChanges[node.id]
    if ((node.data.type === BlockEnum.Loop || node.data.type === BlockEnum.Iteration) && nextSize) {
      node.width = nextSize.width
      node.height = nextSize.height
      node.data.width = nextSize.width
      node.data.height = nextSize.height
    }
  })
})

export const createLayerMap = (layout: LayoutResult) => {
  return Array.from(layout.nodes.values()).reduce<Map<number, LayerInfo>>((acc, layoutInfo) => {
    if (layoutInfo.layer === undefined)
      return acc

    const existing = acc.get(layoutInfo.layer)
    acc.set(layoutInfo.layer, {
      minY: existing ? Math.min(existing.minY, layoutInfo.y) : layoutInfo.y,
      maxHeight: existing ? Math.max(existing.maxHeight, layoutInfo.height) : layoutInfo.height,
    })
    return acc
  }, new Map<number, LayerInfo>())
}

const getAlignedYPosition = (
  layoutInfo: LayoutResult['nodes'] extends Map<string, infer T> ? T : never,
  layerMap: Map<number, LayerInfo>,
) => {
  if (layoutInfo.layer === undefined)
    return layoutInfo.y

  const layerInfo = layerMap.get(layoutInfo.layer)
  if (!layerInfo)
    return layoutInfo.y

  return (layerInfo.minY + layerInfo.maxHeight / 2) - layoutInfo.height / 2
}

export const applyLayoutToNodes = ({
  nodes,
  layout,
  parentNodes,
  childLayoutsMap,
}: {
  nodes: Node[]
  layout: LayoutResult
  parentNodes: Node[]
  childLayoutsMap: Record<string, LayoutResult>
}) => {
  const layerMap = createLayerMap(layout)

  return produce(nodes, (draft) => {
    draft.forEach((node) => {
      if (!node.parentId && node.type === CUSTOM_NODE) {
        const layoutInfo = layout.nodes.get(node.id)
        if (!layoutInfo)
          return

        node.position = {
          x: layoutInfo.x,
          y: getAlignedYPosition(layoutInfo, layerMap),
        }
      }
    })

    parentNodes.forEach((parentNode) => {
      const childLayout = childLayoutsMap[parentNode.id]
      if (!childLayout)
        return

      draft
        .filter(node => node.parentId === parentNode.id)
        .forEach((childNode) => {
          const layoutInfo = childLayout.nodes.get(childNode.id)
          if (!layoutInfo)
            return

          childNode.position = {
            x: NODE_LAYOUT_HORIZONTAL_PADDING + (layoutInfo.x - childLayout.bounds.minX),
            y: NODE_LAYOUT_VERTICAL_PADDING + (layoutInfo.y - childLayout.bounds.minY),
          }
        })
    })
  })
}
