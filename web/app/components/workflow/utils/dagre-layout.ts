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
  const dagreGraph = new dagre.graphlib.Graph({ compound: true })
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const nodes = cloneDeep(originNodes).filter(node => !node.parentId && node.type === CUSTOM_NODE)
  const edges = cloneDeep(originEdges).filter(edge => (!edge.data?.isInIteration && !edge.data?.isInLoop))

// The default dagre layout algorithm often fails to correctly order the branches
// of an If/Else node, leading to crossed edges.
//
// To solve this, we employ a "virtual container" strategy:
// 1. A virtual, compound parent node (the "container") is created for each If/Else node's branches.
// 2. Each direct child of the If/Else node is preceded by a virtual dummy node. These dummies are placed inside the container.
// 3. A rigid, sequential chain of invisible edges is created between these dummy nodes (e.g., dummy_IF -> dummy_ELIF -> dummy_ELSE).
//
// This forces dagre to treat the ordered branches as an unbreakable, atomic group,
// ensuring their layout respects the intended logical sequence.
  const ifElseNodes = nodes.filter(node => node.data.type === BlockEnum.IfElse)
  let virtualLogicApplied = false

  ifElseNodes.forEach((ifElseNode) => {
    const childEdges = edges.filter(e => e.source === ifElseNode.id)
    if (childEdges.length <= 1)
      return

    virtualLogicApplied = true
    const sortedChildEdges = childEdges.sort((edgeA, edgeB) => {
      const handleA = edgeA.sourceHandle
      const handleB = edgeB.sourceHandle

      if (handleA && handleB) {
        const cases = (ifElseNode.data as any).cases || []
        const isAElse = handleA === 'false'
        const isBElse = handleB === 'false'

        if (isAElse) return 1
        if (isBElse) return -1

        const indexA = cases.findIndex((c: any) => c.case_id === handleA)
        const indexB = cases.findIndex((c: any) => c.case_id === handleB)

        if (indexA !== -1 && indexB !== -1)
          return indexA - indexB
      }
      return 0
    })

    const parentDummyId = `dummy-parent-${ifElseNode.id}`
    dagreGraph.setNode(parentDummyId, { width: 1, height: 1 })

    const dummyNodes: string[] = []
    sortedChildEdges.forEach((edge) => {
      const dummyNodeId = `dummy-${edge.source}-${edge.target}`
      dummyNodes.push(dummyNodeId)
      dagreGraph.setNode(dummyNodeId, { width: 1, height: 1 })
      dagreGraph.setParent(dummyNodeId, parentDummyId)

      const edgeIndex = edges.findIndex(e => e.id === edge.id)
      if (edgeIndex > -1)
        edges.splice(edgeIndex, 1)

      edges.push({ id: `e-${edge.source}-${dummyNodeId}`, source: edge.source, target: dummyNodeId, sourceHandle: edge.sourceHandle } as Edge)
      edges.push({ id: `e-${dummyNodeId}-${edge.target}`, source: dummyNodeId, target: edge.target, targetHandle: edge.targetHandle } as Edge)
    })

    for (let i = 0; i < dummyNodes.length - 1; i++) {
      const sourceDummy = dummyNodes[i]
      const targetDummy = dummyNodes[i + 1]
      edges.push({ id: `e-dummy-${sourceDummy}-${targetDummy}`, source: sourceDummy, target: targetDummy } as Edge)
    }
  })

  dagreGraph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 40,
    ranksep: virtualLogicApplied ? 30 : 60,
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
