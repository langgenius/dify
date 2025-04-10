import dagre from '@dagrejs/dagre'
import {
  cloneDeep,
} from 'lodash-es'
import type {
  Edge,
  Node,
} from '../types'
import {
  BlockEnum,
} from '../types'
import {
  CUSTOM_NODE,
  NODE_LAYOUT_HORIZONTAL_PADDING,
  NODE_LAYOUT_MIN_DISTANCE,
  NODE_LAYOUT_VERTICAL_PADDING,
} from '../constants'
import { CUSTOM_ITERATION_START_NODE } from '../nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '../nodes/loop-start/constants'

export const getLayoutByDagre = (originNodes: Node[], originEdges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  const nodes = cloneDeep(originNodes).filter(node => !node.parentId && node.type === CUSTOM_NODE)
  const edges = cloneDeep(originEdges).filter(edge => (!edge.data?.isInIteration && !edge.data?.isInLoop))
  dagreGraph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 40,
    ranksep: 60,
    ranker: 'tight-tree',
    marginx: 30,
    marginy: 200,
  })
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width!,
      height: node.height!,
    })
  })
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })
  dagre.layout(dagreGraph)
  return dagreGraph
}

export const getLayoutForChildNodes = (parentNodeId: string, originNodes: Node[], originEdges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const nodes = cloneDeep(originNodes).filter(node => node.parentId === parentNodeId)
  const edges = cloneDeep(originEdges).filter(edge =>
    (edge.data?.isInIteration && edge.data?.iteration_id === parentNodeId)
    || (edge.data?.isInLoop && edge.data?.loop_id === parentNodeId),
  )

  const startNode = nodes.find(node =>
    node.type === CUSTOM_ITERATION_START_NODE
    || node.type === CUSTOM_LOOP_START_NODE
    || node.data?.type === BlockEnum.LoopStart
    || node.data?.type === BlockEnum.IterationStart,
  )

  if (!startNode) {
    dagreGraph.setGraph({
      rankdir: 'LR',
      align: 'UL',
      nodesep: 40,
      ranksep: 60,
      marginx: NODE_LAYOUT_HORIZONTAL_PADDING,
      marginy: NODE_LAYOUT_VERTICAL_PADDING,
    })

    nodes.forEach((node) => {
      dagreGraph.setNode(node.id, {
        width: node.width || 244,
        height: node.height || 100,
      })
    })

    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target)
    })

    dagre.layout(dagreGraph)
    return dagreGraph
  }

  const startNodeOutEdges = edges.filter(edge => edge.source === startNode.id)
  const firstConnectedNodes = startNodeOutEdges.map(edge =>
    nodes.find(node => node.id === edge.target),
  ).filter(Boolean) as Node[]

  const nonStartNodes = nodes.filter(node => node.id !== startNode.id)
  const nonStartEdges = edges.filter(edge => edge.source !== startNode.id && edge.target !== startNode.id)

  dagreGraph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 40,
    ranksep: 60,
    marginx: NODE_LAYOUT_HORIZONTAL_PADDING / 2,
    marginy: NODE_LAYOUT_VERTICAL_PADDING / 2,
  })

  nonStartNodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width || 244,
      height: node.height || 100,
    })
  })

  nonStartEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const startNodeSize = {
    width: startNode.width || 44,
    height: startNode.height || 48,
  }

  const startNodeX = NODE_LAYOUT_HORIZONTAL_PADDING / 1.5
  let startNodeY = 100

  let minFirstLayerX = Infinity
  let avgFirstLayerY = 0
  let firstLayerCount = 0

  if (firstConnectedNodes.length > 0) {
    firstConnectedNodes.forEach((node) => {
      if (dagreGraph.node(node.id)) {
        const nodePos = dagreGraph.node(node.id)
        avgFirstLayerY += nodePos.y
        firstLayerCount++
        minFirstLayerX = Math.min(minFirstLayerX, nodePos.x - nodePos.width / 2)
      }
    })

    if (firstLayerCount > 0) {
      avgFirstLayerY /= firstLayerCount
      startNodeY = avgFirstLayerY
    }

    const minRequiredX = startNodeX + startNodeSize.width + NODE_LAYOUT_MIN_DISTANCE

    if (minFirstLayerX < minRequiredX) {
      const shiftX = minRequiredX - minFirstLayerX

      nonStartNodes.forEach((node) => {
        if (dagreGraph.node(node.id)) {
          const nodePos = dagreGraph.node(node.id)
          dagreGraph.setNode(node.id, {
            x: nodePos.x + shiftX,
            y: nodePos.y,
            width: nodePos.width,
            height: nodePos.height,
          })
        }
      })
    }
  }

  dagreGraph.setNode(startNode.id, {
    x: startNodeX + startNodeSize.width / 2,
    y: startNodeY,
    width: startNodeSize.width,
    height: startNodeSize.height,
  })

  startNodeOutEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  return dagreGraph
}
