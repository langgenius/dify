import type { ElkNode, LayoutOptions } from 'elkjs/lib/elk-api'
import type { CaseItem, IfElseNodeType } from '@/app/components/workflow/nodes/if-else/types'
import type {
  Edge,
  Node,
} from '@/app/components/workflow/types'
import ELK from 'elkjs/lib/elk.bundled.js'
import { cloneDeep } from 'es-toolkit/object'
import {
  CUSTOM_NODE,
  NODE_LAYOUT_HORIZONTAL_PADDING,
  NODE_LAYOUT_VERTICAL_PADDING,
} from '@/app/components/workflow/constants'
import { CUSTOM_ITERATION_START_NODE } from '@/app/components/workflow/nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '@/app/components/workflow/nodes/loop-start/constants'
import {
  BlockEnum,
} from '@/app/components/workflow/types'

// Although the file name refers to Dagre, the implementation now relies on ELK's layered algorithm.
// Keep the export signatures unchanged to minimise the blast radius while we migrate the layout stack.

const elk = new ELK()

const DEFAULT_NODE_WIDTH = 244
const DEFAULT_NODE_HEIGHT = 100

const ROOT_LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',

  // === Spacing - Maximum spacing to prevent any overlap ===
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.spacing.nodeNode': '80',
  'elk.spacing.edgeNode': '50',
  'elk.spacing.edgeEdge': '30',
  'elk.spacing.edgeLabel': '10',
  'elk.spacing.portPort': '20',

  // === Port Configuration ===
  'elk.portConstraints': 'FIXED_ORDER',
  'elk.layered.considerModelOrder.strategy': 'PREFER_EDGES',
  'elk.port.side': 'SOUTH',

  // === Node Placement - Best quality ===
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.nodePlacement.linearSegments.deflectionDampening': '0.5',
  'elk.layered.nodePlacement.networkSimplex.nodeFlexibility': 'NODE_SIZE',

  // === Edge Routing - Maximum quality ===
  'elk.edgeRouting': 'SPLINES',
  'elk.layered.edgeRouting.selfLoopPlacement': 'NORTH',
  'elk.layered.edgeRouting.sloppySplineRouting': 'false',
  'elk.layered.edgeRouting.splines.mode': 'CONSERVATIVE',
  'elk.layered.edgeRouting.splines.sloppy.layerSpacingFactor': '1.2',

  // === Crossing Minimization - Most aggressive ===
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  'elk.layered.crossingMinimization.greedySwitchHierarchical.type': 'TWO_SIDED',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.layered.crossingMinimization.hierarchicalSweepiness': '0.9',

  // === Layering Strategy - Best quality ===
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.layering.networkSimplex.nodeFlexibility': 'NODE_SIZE',
  'elk.layered.layering.layerConstraint': 'NONE',
  'elk.layered.layering.minWidth.upperBoundOnWidth': '4',

  // === Cycle Breaking ===
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',

  // === Connected Components ===
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '100',

  // === Node Size Constraints ===
  'elk.nodeSize.constraints': 'NODE_LABELS',
  'elk.nodeSize.options': 'DEFAULT_MINIMUM_SIZE MINIMUM_SIZE_ACCOUNTS_FOR_PADDING',

  // === Edge Label Placement ===
  'elk.edgeLabels.placement': 'CENTER',
  'elk.edgeLabels.inline': 'true',

  // === Compaction ===
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.layered.compaction.postCompaction.constraints': 'EDGE_LENGTH',

  // === High-Quality Mode ===
  'elk.layered.thoroughness': '10',
  'elk.layered.wrapping.strategy': 'OFF',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',

  // === Additional Optimizations ===
  'elk.layered.feedbackEdges': 'true',
  'elk.layered.mergeEdges': 'false',
  'elk.layered.mergeHierarchyEdges': 'false',
  'elk.layered.allowNonFlowPortsToSwitchSides': 'false',
  'elk.layered.northOrSouthPort': 'false',
  'elk.partitioning.activate': 'false',
  'elk.junctionPoints': 'true',

  // === Content Alignment ===
  'elk.contentAlignment': 'V_TOP H_LEFT',
  'elk.alignment': 'AUTOMATIC',
}

const CHILD_LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',

  // === Spacing - High quality for child nodes ===
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeNode': '40',
  'elk.spacing.edgeEdge': '25',
  'elk.spacing.edgeLabel': '8',
  'elk.spacing.portPort': '15',

  // === Node Placement - Best quality ===
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.nodePlacement.linearSegments.deflectionDampening': '0.5',
  'elk.layered.nodePlacement.networkSimplex.nodeFlexibility': 'NODE_SIZE',

  // === Edge Routing - Maximum quality ===
  'elk.edgeRouting': 'SPLINES',
  'elk.layered.edgeRouting.sloppySplineRouting': 'false',
  'elk.layered.edgeRouting.splines.mode': 'CONSERVATIVE',

  // === Crossing Minimization - Aggressive ===
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  'elk.layered.crossingMinimization.semiInteractive': 'true',

  // === Layering Strategy ===
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.layering.networkSimplex.nodeFlexibility': 'NODE_SIZE',

  // === Cycle Breaking ===
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',

  // === Node Size ===
  'elk.nodeSize.constraints': 'NODE_LABELS',

  // === Compaction ===
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',

  // === High-Quality Mode ===
  'elk.layered.thoroughness': '10',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',

  // === Additional Optimizations ===
  'elk.layered.feedbackEdges': 'true',
  'elk.layered.mergeEdges': 'false',
  'elk.junctionPoints': 'true',
}

type LayoutInfo = {
  x: number
  y: number
  width: number
  height: number
  layer?: number
}

type LayoutBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type LayoutResult = {
  nodes: Map<string, LayoutInfo>
  bounds: LayoutBounds
}

// ELK Port definition for native port support
type ElkPortShape = {
  id: string
  layoutOptions?: LayoutOptions
}

type ElkNodeShape = {
  id: string
  width: number
  height: number
  ports?: ElkPortShape[]
  layoutOptions?: LayoutOptions
  children?: ElkNodeShape[]
}

type ElkEdgeShape = {
  id: string
  sources: string[]
  targets: string[]
  sourcePort?: string
  targetPort?: string
}

const toElkNode = (node: Node): ElkNodeShape => ({
  id: node.id,
  width: node.width ?? DEFAULT_NODE_WIDTH,
  height: node.height ?? DEFAULT_NODE_HEIGHT,
})

let edgeCounter = 0
const nextEdgeId = () => `elk-edge-${edgeCounter++}`

const createEdge = (
  source: string,
  target: string,
  sourcePort?: string,
  targetPort?: string,
): ElkEdgeShape => ({
  id: nextEdgeId(),
  sources: [source],
  targets: [target],
  sourcePort,
  targetPort,
})

const collectLayout = (graph: ElkNode, predicate: (id: string) => boolean): LayoutResult => {
  const result = new Map<string, LayoutInfo>()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const visit = (node: ElkNode) => {
    node.children?.forEach((child: ElkNode) => {
      if (predicate(child.id)) {
        const x = child.x ?? 0
        const y = child.y ?? 0
        const width = child.width ?? DEFAULT_NODE_WIDTH
        const height = child.height ?? DEFAULT_NODE_HEIGHT
        const layer = child?.layoutOptions?.['org.eclipse.elk.layered.layerIndex']

        result.set(child.id, {
          x,
          y,
          width,
          height,
          layer: layer ? Number.parseInt(layer) : undefined,
        })

        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + width)
        maxY = Math.max(maxY, y + height)
      }

      if (child.children?.length)
        visit(child)
    })
  }

  visit(graph)

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0
    minY = 0
    maxX = 0
    maxY = 0
  }

  return {
    nodes: result,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
    },
  }
}

/**
 * Build If/Else node with ELK native Ports instead of dummy nodes
 * This is the recommended approach for handling multiple branches
 */
const buildIfElseWithPorts = (
  ifElseNode: Node,
  edges: Edge[],
): { node: ElkNodeShape, portMap: Map<string, string> } | null => {
  const childEdges = edges.filter(edge => edge.source === ifElseNode.id)

  if (childEdges.length <= 1)
    return null

  // Sort child edges according to case order
  const sortedChildEdges = [...childEdges].sort((edgeA, edgeB) => {
    const handleA = edgeA.sourceHandle
    const handleB = edgeB.sourceHandle

    if (handleA && handleB) {
      const cases = (ifElseNode.data as IfElseNodeType).cases || []
      const isAElse = handleA === 'false'
      const isBElse = handleB === 'false'

      if (isAElse)
        return 1
      if (isBElse)
        return -1

      const indexA = cases.findIndex((c: CaseItem) => c.case_id === handleA)
      const indexB = cases.findIndex((c: CaseItem) => c.case_id === handleB)

      if (indexA !== -1 && indexB !== -1)
        return indexA - indexB
    }

    return 0
  })

  // Create ELK ports for each branch
  const ports: ElkPortShape[] = sortedChildEdges.map((edge, index) => ({
    id: `${ifElseNode.id}-port-${edge.sourceHandle || index}`,
    layoutOptions: {
      'port.side': 'EAST', // Ports on the right side (matching 'RIGHT' direction)
      'port.index': String(index),
    },
  }))

  // Build port mapping: sourceHandle -> portId
  const portMap = new Map<string, string>()
  sortedChildEdges.forEach((edge, index) => {
    const portId = `${ifElseNode.id}-port-${edge.sourceHandle || index}`
    portMap.set(edge.id, portId)
  })

  return {
    node: {
      id: ifElseNode.id,
      width: ifElseNode.width ?? DEFAULT_NODE_WIDTH,
      height: ifElseNode.height ?? DEFAULT_NODE_HEIGHT,
      ports,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_ORDER',
      },
    },
    portMap,
  }
}

const normaliseBounds = (layout: LayoutResult): LayoutResult => {
  const {
    nodes,
    bounds,
  } = layout

  if (nodes.size === 0)
    return layout

  const offsetX = bounds.minX
  const offsetY = bounds.minY

  const adjustedNodes = new Map<string, LayoutInfo>()
  nodes.forEach((info, id) => {
    adjustedNodes.set(id, {
      ...info,
      x: info.x - offsetX,
      y: info.y - offsetY,
    })
  })

  return {
    nodes: adjustedNodes,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: bounds.maxX - offsetX,
      maxY: bounds.maxY - offsetY,
    },
  }
}

export const getLayoutByDagre = async (originNodes: Node[], originEdges: Edge[]): Promise<LayoutResult> => {
  edgeCounter = 0
  const nodes = cloneDeep(originNodes).filter(node => !node.parentId && node.type === CUSTOM_NODE)
  const edges = cloneDeep(originEdges).filter(edge => (!edge.data?.isInIteration && !edge.data?.isInLoop))

  const elkNodes: ElkNodeShape[] = []
  const elkEdges: ElkEdgeShape[] = []

  // Track which edges have been processed for If/Else nodes with ports
  const edgeToPortMap = new Map<string, string>()

  // Build nodes with ports for If/Else nodes
  nodes.forEach((node) => {
    if (node.data.type === BlockEnum.IfElse) {
      const portsResult = buildIfElseWithPorts(node, edges)
      if (portsResult) {
        // Use node with ports
        elkNodes.push(portsResult.node)
        // Store port mappings for edges
        portsResult.portMap.forEach((portId, edgeId) => {
          edgeToPortMap.set(edgeId, portId)
        })
      }
      else {
        // No multiple branches, use normal node
        elkNodes.push(toElkNode(node))
      }
    }
    else {
      elkNodes.push(toElkNode(node))
    }
  })

  // Build edges with port connections
  edges.forEach((edge) => {
    const sourcePort = edgeToPortMap.get(edge.id)
    elkEdges.push(createEdge(edge.source, edge.target, sourcePort))
  })

  const graph = {
    id: 'workflow-root',
    layoutOptions: ROOT_LAYOUT_OPTIONS,
    children: elkNodes,
    edges: elkEdges,
  }

  const layoutedGraph = await elk.layout(graph)
  // No need to filter dummy nodes anymore, as we're using ports
  const layout = collectLayout(layoutedGraph, () => true)
  return normaliseBounds(layout)
}

const normaliseChildLayout = (
  layout: LayoutResult,
  nodes: Node[],
): LayoutResult => {
  const result = new Map<string, LayoutInfo>()
  layout.nodes.forEach((info, id) => {
    result.set(id, info)
  })

  // Ensure iteration / loop start nodes do not collapse into the children.
  const startNode = nodes.find(node =>
    node.type === CUSTOM_ITERATION_START_NODE
    || node.type === CUSTOM_LOOP_START_NODE
    || node.data?.type === BlockEnum.LoopStart
    || node.data?.type === BlockEnum.IterationStart,
  )

  if (startNode) {
    const startLayout = result.get(startNode.id)

    if (startLayout) {
      const desiredMinX = NODE_LAYOUT_HORIZONTAL_PADDING / 1.5
      if (startLayout.x > desiredMinX) {
        const shiftX = startLayout.x - desiredMinX
        result.forEach((value, key) => {
          result.set(key, {
            ...value,
            x: value.x - shiftX,
          })
        })
      }

      const desiredMinY = startLayout.y
      const deltaY = NODE_LAYOUT_VERTICAL_PADDING / 2
      result.forEach((value, key) => {
        result.set(key, {
          ...value,
          y: value.y - desiredMinY + deltaY,
        })
      })
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  result.forEach((value) => {
    minX = Math.min(minX, value.x)
    minY = Math.min(minY, value.y)
    maxX = Math.max(maxX, value.x + value.width)
    maxY = Math.max(maxY, value.y + value.height)
  })

  if (!Number.isFinite(minX) || !Number.isFinite(minY))
    return layout

  return normaliseBounds({
    nodes: result,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
    },
  })
}

export const getLayoutForChildNodes = async (
  parentNodeId: string,
  originNodes: Node[],
  originEdges: Edge[],
): Promise<LayoutResult | null> => {
  edgeCounter = 0
  const nodes = cloneDeep(originNodes).filter(node => node.parentId === parentNodeId)
  if (!nodes.length)
    return null

  const edges = cloneDeep(originEdges).filter(edge =>
    (edge.data?.isInIteration && edge.data?.iteration_id === parentNodeId)
    || (edge.data?.isInLoop && edge.data?.loop_id === parentNodeId),
  )

  const elkNodes: ElkNodeShape[] = nodes.map(toElkNode)
  const elkEdges: ElkEdgeShape[] = edges.map(edge => createEdge(edge.source, edge.target))

  const graph = {
    id: parentNodeId,
    layoutOptions: CHILD_LAYOUT_OPTIONS,
    children: elkNodes,
    edges: elkEdges,
  }

  const layoutedGraph = await elk.layout(graph)
  const layout = collectLayout(layoutedGraph, () => true)
  return normaliseChildLayout(layout, nodes)
}
