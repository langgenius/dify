import {
  Position,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
} from 'reactflow'
import dagre from '@dagrejs/dagre'
import { v4 as uuid4 } from 'uuid'
import {
  cloneDeep,
  groupBy,
  isEqual,
  uniqBy,
} from 'lodash-es'
import type {
  Edge,
  InputVar,
  Node,
  ToolWithProvider,
  ValueSelector,
} from './types'
import {
  BlockEnum,
  ErrorHandleMode,
  NodeRunningStatus,
} from './types'
import {
  CUSTOM_NODE,
  DEFAULT_RETRY_INTERVAL,
  DEFAULT_RETRY_MAX,
  ITERATION_CHILDREN_Z_INDEX,
  ITERATION_NODE_Z_INDEX,
  LOOP_CHILDREN_Z_INDEX,
  LOOP_NODE_Z_INDEX,
  NODE_LAYOUT_HORIZONTAL_PADDING,
  NODE_LAYOUT_MIN_DISTANCE,
  NODE_LAYOUT_VERTICAL_PADDING,
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from './constants'
import { CUSTOM_ITERATION_START_NODE } from './nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from './nodes/loop-start/constants'
import type { QuestionClassifierNodeType } from './nodes/question-classifier/types'
import type { IfElseNodeType } from './nodes/if-else/types'
import { branchNameCorrect } from './nodes/if-else/utils'
import type { ToolNodeType } from './nodes/tool/types'
import type { IterationNodeType } from './nodes/iteration/types'
import type { LoopNodeType } from './nodes/loop/types'
import { CollectionType } from '@/app/components/tools/types'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { canFindTool, correctModelProvider } from '@/utils'
import { CUSTOM_SIMPLE_NODE } from '@/app/components/workflow/simple-node/constants'

const WHITE = 'WHITE'
const GRAY = 'GRAY'
const BLACK = 'BLACK'

const isCyclicUtil = (nodeId: string, color: Record<string, string>, adjList: Record<string, string[]>, stack: string[]) => {
  color[nodeId] = GRAY
  stack.push(nodeId)

  for (let i = 0; i < adjList[nodeId].length; ++i) {
    const childId = adjList[nodeId][i]

    if (color[childId] === GRAY) {
      stack.push(childId)
      return true
    }
    if (color[childId] === WHITE && isCyclicUtil(childId, color, adjList, stack))
      return true
  }
  color[nodeId] = BLACK
  if (stack.length > 0 && stack[stack.length - 1] === nodeId)
    stack.pop()
  return false
}

const getCycleEdges = (nodes: Node[], edges: Edge[]) => {
  const adjList: Record<string, string[]> = {}
  const color: Record<string, string> = {}
  const stack: string[] = []

  for (const node of nodes) {
    color[node.id] = WHITE
    adjList[node.id] = []
  }

  for (const edge of edges)
    adjList[edge.source]?.push(edge.target)

  for (let i = 0; i < nodes.length; i++) {
    if (color[nodes[i].id] === WHITE)
      isCyclicUtil(nodes[i].id, color, adjList, stack)
  }

  const cycleEdges = []
  if (stack.length > 0) {
    const cycleNodes = new Set(stack)
    for (const edge of edges) {
      if (cycleNodes.has(edge.source) && cycleNodes.has(edge.target))
        cycleEdges.push(edge)
    }
  }

  return cycleEdges
}

export function getIterationStartNode(iterationId: string): Node {
  return generateNewNode({
    id: `${iterationId}start`,
    type: CUSTOM_ITERATION_START_NODE,
    data: {
      title: '',
      desc: '',
      type: BlockEnum.IterationStart,
      isInIteration: true,
    },
    position: {
      x: 24,
      y: 68,
    },
    zIndex: ITERATION_CHILDREN_Z_INDEX,
    parentId: iterationId,
    selectable: false,
    draggable: false,
  }).newNode
}

export function getLoopStartNode(loopId: string): Node {
  return generateNewNode({
    id: `${loopId}start`,
    type: CUSTOM_LOOP_START_NODE,
    data: {
      title: '',
      desc: '',
      type: BlockEnum.LoopStart,
      isInLoop: true,
    },
    position: {
      x: 24,
      y: 68,
    },
    zIndex: LOOP_CHILDREN_Z_INDEX,
    parentId: loopId,
    selectable: false,
    draggable: false,
  }).newNode
}

export function generateNewNode({ data, position, id, zIndex, type, ...rest }: Omit<Node, 'id'> & { id?: string }): {
  newNode: Node
  newIterationStartNode?: Node
  newLoopStartNode?: Node
} {
  const newNode = {
    id: id || `${Date.now()}`,
    type: type || CUSTOM_NODE,
    data,
    position,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
    zIndex: data.type === BlockEnum.Iteration ? ITERATION_NODE_Z_INDEX : (data.type === BlockEnum.Loop ? LOOP_NODE_Z_INDEX : zIndex),
    ...rest,
  } as Node

  if (data.type === BlockEnum.Iteration) {
    const newIterationStartNode = getIterationStartNode(newNode.id);
    (newNode.data as IterationNodeType).start_node_id = newIterationStartNode.id;
    (newNode.data as IterationNodeType)._children = [{ nodeId: newIterationStartNode.id, nodeType: BlockEnum.IterationStart }]
    return {
      newNode,
      newIterationStartNode,
    }
  }

  if (data.type === BlockEnum.Loop) {
    const newLoopStartNode = getLoopStartNode(newNode.id);
    (newNode.data as LoopNodeType).start_node_id = newLoopStartNode.id;
    (newNode.data as LoopNodeType)._children = [{ nodeId: newLoopStartNode.id, nodeType: BlockEnum.LoopStart }]
    return {
      newNode,
      newLoopStartNode,
    }
  }

  return {
    newNode,
  }
}

export const preprocessNodesAndEdges = (nodes: Node[], edges: Edge[]) => {
  const hasIterationNode = nodes.some(node => node.data.type === BlockEnum.Iteration)
  const hasLoopNode = nodes.some(node => node.data.type === BlockEnum.Loop)

  if (!hasIterationNode) {
    return {
      nodes,
      edges,
    }
  }

  if (!hasLoopNode) {
    return {
      nodes,
      edges,
    }
  }

  const nodesMap = nodes.reduce((prev, next) => {
    prev[next.id] = next
    return prev
  }, {} as Record<string, Node>)

  const iterationNodesWithStartNode = []
  const iterationNodesWithoutStartNode = []
  const loopNodesWithStartNode = []
  const loopNodesWithoutStartNode = []

  for (let i = 0; i < nodes.length; i++) {
    const currentNode = nodes[i] as Node<IterationNodeType | LoopNodeType>

    if (currentNode.data.type === BlockEnum.Iteration) {
      if (currentNode.data.start_node_id) {
        if (nodesMap[currentNode.data.start_node_id]?.type !== CUSTOM_ITERATION_START_NODE)
          iterationNodesWithStartNode.push(currentNode)
      }
      else {
        iterationNodesWithoutStartNode.push(currentNode)
      }
    }

    if (currentNode.data.type === BlockEnum.Loop) {
      if (currentNode.data.start_node_id) {
        if (nodesMap[currentNode.data.start_node_id]?.type !== CUSTOM_LOOP_START_NODE)
          loopNodesWithStartNode.push(currentNode)
      }
      else {
        loopNodesWithoutStartNode.push(currentNode)
      }
    }
  }

  const newIterationStartNodesMap = {} as Record<string, Node>
  const newIterationStartNodes = [...iterationNodesWithStartNode, ...iterationNodesWithoutStartNode].map((iterationNode, index) => {
    const newNode = getIterationStartNode(iterationNode.id)
    newNode.id = newNode.id + index
    newIterationStartNodesMap[iterationNode.id] = newNode
    return newNode
  })

  const newLoopStartNodesMap = {} as Record<string, Node>
  const newLoopStartNodes = [...loopNodesWithStartNode, ...loopNodesWithoutStartNode].map((loopNode, index) => {
    const newNode = getLoopStartNode(loopNode.id)
    newNode.id = newNode.id + index
    newLoopStartNodesMap[loopNode.id] = newNode
    return newNode
  })

  const newEdges = [...iterationNodesWithStartNode, ...loopNodesWithStartNode].map((nodeItem) => {
    const isIteration = nodeItem.data.type === BlockEnum.Iteration
    const newNode = (isIteration ? newIterationStartNodesMap : newLoopStartNodesMap)[nodeItem.id]
    const startNode = nodesMap[nodeItem.data.start_node_id]
    const source = newNode.id
    const sourceHandle = 'source'
    const target = startNode.id
    const targetHandle = 'target'

    const parentNode = nodes.find(node => node.id === startNode.parentId) || null
    const isInIteration = !!parentNode && parentNode.data.type === BlockEnum.Iteration
    const isInLoop = !!parentNode && parentNode.data.type === BlockEnum.Loop

    return {
      id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
      type: 'custom',
      source,
      sourceHandle,
      target,
      targetHandle,
      data: {
        sourceType: newNode.data.type,
        targetType: startNode.data.type,
        isInIteration,
        iteration_id: isInIteration ? startNode.parentId : undefined,
        isInLoop,
        loop_id: isInLoop ? startNode.parentId : undefined,
        _connectedNodeIsSelected: true,
      },
      zIndex: isIteration ? ITERATION_CHILDREN_Z_INDEX : LOOP_CHILDREN_Z_INDEX,
    }
  })
  nodes.forEach((node) => {
    if (node.data.type === BlockEnum.Iteration && newIterationStartNodesMap[node.id])
      (node.data as IterationNodeType).start_node_id = newIterationStartNodesMap[node.id].id

    if (node.data.type === BlockEnum.Loop && newLoopStartNodesMap[node.id])
      (node.data as LoopNodeType).start_node_id = newLoopStartNodesMap[node.id].id
  })

  return {
    nodes: [...nodes, ...newIterationStartNodes, ...newLoopStartNodes],
    edges: [...edges, ...newEdges],
  }
}

export const initialNodes = (originNodes: Node[], originEdges: Edge[]) => {
  const { nodes, edges } = preprocessNodesAndEdges(cloneDeep(originNodes), cloneDeep(originEdges))
  const firstNode = nodes[0]

  if (!firstNode?.position) {
    nodes.forEach((node, index) => {
      node.position = {
        x: START_INITIAL_POSITION.x + index * NODE_WIDTH_X_OFFSET,
        y: START_INITIAL_POSITION.y,
      }
    })
  }

  const iterationOrLoopNodeMap = nodes.reduce((acc, node) => {
    if (node.parentId) {
      if (acc[node.parentId])
        acc[node.parentId].push({ nodeId: node.id, nodeType: node.data.type })
      else
        acc[node.parentId] = [{ nodeId: node.id, nodeType: node.data.type }]
    }
    return acc
  }, {} as Record<string, { nodeId: string; nodeType: BlockEnum }[]>)

  return nodes.map((node) => {
    if (!node.type)
      node.type = CUSTOM_NODE

    const connectedEdges = getConnectedEdges([node], edges)
    node.data._connectedSourceHandleIds = connectedEdges.filter(edge => edge.source === node.id).map(edge => edge.sourceHandle || 'source')
    node.data._connectedTargetHandleIds = connectedEdges.filter(edge => edge.target === node.id).map(edge => edge.targetHandle || 'target')

    if (node.data.type === BlockEnum.IfElse) {
      const nodeData = node.data as IfElseNodeType

      if (!nodeData.cases && nodeData.logical_operator && nodeData.conditions) {
        (node.data as IfElseNodeType).cases = [
          {
            case_id: 'true',
            logical_operator: nodeData.logical_operator,
            conditions: nodeData.conditions,
          },
        ]
      }
      node.data._targetBranches = branchNameCorrect([
        ...(node.data as IfElseNodeType).cases.map(item => ({ id: item.case_id, name: '' })),
        { id: 'false', name: '' },
      ])
    }

    if (node.data.type === BlockEnum.QuestionClassifier) {
      node.data._targetBranches = (node.data as QuestionClassifierNodeType).classes.map((topic) => {
        return topic
      })
    }

    if (node.data.type === BlockEnum.Iteration) {
      const iterationNodeData = node.data as IterationNodeType
      iterationNodeData._children = iterationOrLoopNodeMap[node.id] || []
      iterationNodeData.is_parallel = iterationNodeData.is_parallel || false
      iterationNodeData.parallel_nums = iterationNodeData.parallel_nums || 10
      iterationNodeData.error_handle_mode = iterationNodeData.error_handle_mode || ErrorHandleMode.Terminated
    }

    // TODO: loop error handle mode
    if (node.data.type === BlockEnum.Loop) {
      const loopNodeData = node.data as LoopNodeType
      loopNodeData._children = iterationOrLoopNodeMap[node.id] || []
      loopNodeData.error_handle_mode = loopNodeData.error_handle_mode || ErrorHandleMode.Terminated
    }

    // legacy provider handle
    if (node.data.type === BlockEnum.LLM)
      (node as any).data.model.provider = correctModelProvider((node as any).data.model.provider)

    if (node.data.type === BlockEnum.KnowledgeRetrieval && (node as any).data.multiple_retrieval_config?.reranking_model)
      (node as any).data.multiple_retrieval_config.reranking_model.provider = correctModelProvider((node as any).data.multiple_retrieval_config?.reranking_model.provider)

    if (node.data.type === BlockEnum.QuestionClassifier)
      (node as any).data.model.provider = correctModelProvider((node as any).data.model.provider)

    if (node.data.type === BlockEnum.ParameterExtractor)
      (node as any).data.model.provider = correctModelProvider((node as any).data.model.provider)
    if (node.data.type === BlockEnum.HttpRequest && !node.data.retry_config) {
      node.data.retry_config = {
        retry_enabled: true,
        max_retries: DEFAULT_RETRY_MAX,
        retry_interval: DEFAULT_RETRY_INTERVAL,
      }
    }

    return node
  })
}

export const initialEdges = (originEdges: Edge[], originNodes: Node[]) => {
  const { nodes, edges } = preprocessNodesAndEdges(cloneDeep(originNodes), cloneDeep(originEdges))
  let selectedNode: Node | null = null
  const nodesMap = nodes.reduce((acc, node) => {
    acc[node.id] = node

    if (node.data?.selected)
      selectedNode = node

    return acc
  }, {} as Record<string, Node>)

  const cycleEdges = getCycleEdges(nodes, edges)
  return edges.filter((edge) => {
    return !cycleEdges.find(cycEdge => cycEdge.source === edge.source && cycEdge.target === edge.target)
  }).map((edge) => {
    edge.type = 'custom'

    if (!edge.sourceHandle)
      edge.sourceHandle = 'source'

    if (!edge.targetHandle)
      edge.targetHandle = 'target'

    if (!edge.data?.sourceType && edge.source && nodesMap[edge.source]) {
      edge.data = {
        ...edge.data,
        sourceType: nodesMap[edge.source].data.type!,
      } as any
    }

    if (!edge.data?.targetType && edge.target && nodesMap[edge.target]) {
      edge.data = {
        ...edge.data,
        targetType: nodesMap[edge.target].data.type!,
      } as any
    }

    if (selectedNode) {
      edge.data = {
        ...edge.data,
        _connectedNodeIsSelected: edge.source === selectedNode.id || edge.target === selectedNode.id,
      } as any
    }

    return edge
  })
}

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

export const canRunBySingle = (nodeType: BlockEnum) => {
  return nodeType === BlockEnum.LLM
    || nodeType === BlockEnum.KnowledgeRetrieval
    || nodeType === BlockEnum.Code
    || nodeType === BlockEnum.TemplateTransform
    || nodeType === BlockEnum.QuestionClassifier
    || nodeType === BlockEnum.HttpRequest
    || nodeType === BlockEnum.Tool
    || nodeType === BlockEnum.ParameterExtractor
    || nodeType === BlockEnum.Iteration
    || nodeType === BlockEnum.Agent
    || nodeType === BlockEnum.DocExtractor
    || nodeType === BlockEnum.Loop
}

type ConnectedSourceOrTargetNodesChange = {
  type: string
  edge: Edge
}[]
export const getNodesConnectedSourceOrTargetHandleIdsMap = (changes: ConnectedSourceOrTargetNodesChange, nodes: Node[]) => {
  const nodesConnectedSourceOrTargetHandleIdsMap = {} as Record<string, any>

  changes.forEach((change) => {
    const {
      edge,
      type,
    } = change
    const sourceNode = nodes.find(node => node.id === edge.source)!
    if (sourceNode) {
      nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] || {
        _connectedSourceHandleIds: [...(sourceNode?.data._connectedSourceHandleIds || [])],
        _connectedTargetHandleIds: [...(sourceNode?.data._connectedTargetHandleIds || [])],
      }
    }

    const targetNode = nodes.find(node => node.id === edge.target)!
    if (targetNode) {
      nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] || {
        _connectedSourceHandleIds: [...(targetNode?.data._connectedSourceHandleIds || [])],
        _connectedTargetHandleIds: [...(targetNode?.data._connectedTargetHandleIds || [])],
      }
    }

    if (sourceNode) {
      if (type === 'remove') {
        const index = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.findIndex((handleId: string) => handleId === edge.sourceHandle)
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.splice(index, 1)
      }

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.push(edge.sourceHandle || 'source')
    }

    if (targetNode) {
      if (type === 'remove') {
        const index = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.findIndex((handleId: string) => handleId === edge.targetHandle)
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.splice(index, 1)
      }

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.push(edge.targetHandle || 'target')
    }
  })

  return nodesConnectedSourceOrTargetHandleIdsMap
}

export const genNewNodeTitleFromOld = (oldTitle: string) => {
  const regex = /^(.+?)\s*\((\d+)\)\s*$/
  const match = oldTitle.match(regex)

  if (match) {
    const title = match[1]
    const num = Number.parseInt(match[2], 10)
    return `${title} (${num + 1})`
  }
  else {
    return `${oldTitle} (1)`
  }
}

export const getValidTreeNodes = (nodes: Node[], edges: Edge[]) => {
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)

  if (!startNode) {
    return {
      validNodes: [],
      maxDepth: 0,
    }
  }

  const list: Node[] = [startNode]
  let maxDepth = 1

  const traverse = (root: Node, depth: number) => {
    if (depth > maxDepth)
      maxDepth = depth

    const outgoers = getOutgoers(root, nodes, edges)

    if (outgoers.length) {
      outgoers.forEach((outgoer) => {
        list.push(outgoer)

        if (outgoer.data.type === BlockEnum.Iteration)
          list.push(...nodes.filter(node => node.parentId === outgoer.id))
        if (outgoer.data.type === BlockEnum.Loop)
          list.push(...nodes.filter(node => node.parentId === outgoer.id))

        traverse(outgoer, depth + 1)
      })
    }
    else {
      list.push(root)

      if (root.data.type === BlockEnum.Iteration)
        list.push(...nodes.filter(node => node.parentId === root.id))
      if (root.data.type === BlockEnum.Loop)
        list.push(...nodes.filter(node => node.parentId === root.id))
    }
  }

  traverse(startNode, maxDepth)

  return {
    validNodes: uniqBy(list, 'id'),
    maxDepth,
  }
}

export const getToolCheckParams = (
  toolData: ToolNodeType,
  buildInTools: ToolWithProvider[],
  customTools: ToolWithProvider[],
  workflowTools: ToolWithProvider[],
  language: string,
) => {
  const { provider_id, provider_type, tool_name } = toolData
  const isBuiltIn = provider_type === CollectionType.builtIn
  const currentTools = provider_type === CollectionType.builtIn ? buildInTools : provider_type === CollectionType.custom ? customTools : workflowTools
  const currCollection = currentTools.find(item => canFindTool(item.id, provider_id))
  const currTool = currCollection?.tools.find(tool => tool.name === tool_name)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  const toolInputVarSchema = formSchemas.filter((item: any) => item.form === 'llm')
  const toolSettingSchema = formSchemas.filter((item: any) => item.form !== 'llm')

  return {
    toolInputsSchema: (() => {
      const formInputs: InputVar[] = []
      toolInputVarSchema.forEach((item: any) => {
        formInputs.push({
          label: item.label[language] || item.label.en_US,
          variable: item.variable,
          type: item.type,
          required: item.required,
        })
      })
      return formInputs
    })(),
    notAuthed: isBuiltIn && !!currCollection?.allow_delete && !currCollection?.is_team_authorization,
    toolSettingSchema,
    language,
  }
}

export const changeNodesAndEdgesId = (nodes: Node[], edges: Edge[]) => {
  const idMap = nodes.reduce((acc, node) => {
    acc[node.id] = uuid4()

    return acc
  }, {} as Record<string, string>)

  const newNodes = nodes.map((node) => {
    return {
      ...node,
      id: idMap[node.id],
    }
  })

  const newEdges = edges.map((edge) => {
    return {
      ...edge,
      source: idMap[edge.source],
      target: idMap[edge.target],
    }
  })

  return [newNodes, newEdges] as [Node[], Edge[]]
}

export const isMac = () => {
  return navigator.userAgent.toUpperCase().includes('MAC')
}

const specialKeysNameMap: Record<string, string | undefined> = {
  ctrl: '⌘',
  alt: '⌥',
  shift: '⇧',
}

export const getKeyboardKeyNameBySystem = (key: string) => {
  if (isMac())
    return specialKeysNameMap[key] || key

  return key
}

const specialKeysCodeMap: Record<string, string | undefined> = {
  ctrl: 'meta',
}

export const getKeyboardKeyCodeBySystem = (key: string) => {
  if (isMac())
    return specialKeysCodeMap[key] || key

  return key
}

export const getTopLeftNodePosition = (nodes: Node[]) => {
  let minX = Infinity
  let minY = Infinity

  nodes.forEach((node) => {
    if (node.position.x < minX)
      minX = node.position.x

    if (node.position.y < minY)
      minY = node.position.y
  })

  return {
    x: minX,
    y: minY,
  }
}

export const isEventTargetInputArea = (target: HTMLElement) => {
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
    return true

  if (target.contentEditable === 'true')
    return true
}

export const variableTransformer = (v: ValueSelector | string) => {
  if (typeof v === 'string')
    return v.replace(/^{{#|#}}$/g, '').split('.')

  return `{{#${v.join('.')}#}}`
}

type ParallelInfoItem = {
  parallelNodeId: string
  depth: number
  isBranch?: boolean
}
type NodeParallelInfo = {
  parallelNodeId: string
  edgeHandleId: string
  depth: number
}
type NodeHandle = {
  node: Node
  handle: string
}
type NodeStreamInfo = {
  upstreamNodes: Set<string>
  downstreamEdges: Set<string>
}
export const getParallelInfo = (nodes: Node[], edges: Edge[], parentNodeId?: string) => {
  let startNode

  if (parentNodeId) {
    const parentNode = nodes.find(node => node.id === parentNodeId)
    if (!parentNode)
      throw new Error('Parent node not found')

    startNode = nodes.find(node => node.id === (parentNode.data as (IterationNodeType | LoopNodeType)).start_node_id)
  }
  else {
    startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  }
  if (!startNode)
    throw new Error('Start node not found')

  const parallelList = [] as ParallelInfoItem[]
  const nextNodeHandles = [{ node: startNode, handle: 'source' }]
  let hasAbnormalEdges = false

  const traverse = (firstNodeHandle: NodeHandle) => {
    const nodeEdgesSet = {} as Record<string, Set<string>>
    const totalEdgesSet = new Set<string>()
    const nextHandles = [firstNodeHandle]
    const streamInfo = {} as Record<string, NodeStreamInfo>
    const parallelListItem = {
      parallelNodeId: '',
      depth: 0,
    } as ParallelInfoItem
    const nodeParallelInfoMap = {} as Record<string, NodeParallelInfo>
    nodeParallelInfoMap[firstNodeHandle.node.id] = {
      parallelNodeId: '',
      edgeHandleId: '',
      depth: 0,
    }

    while (nextHandles.length) {
      const currentNodeHandle = nextHandles.shift()!
      const { node: currentNode, handle: currentHandle = 'source' } = currentNodeHandle
      const currentNodeHandleKey = currentNode.id
      const connectedEdges = edges.filter(edge => edge.source === currentNode.id && edge.sourceHandle === currentHandle)
      const connectedEdgesLength = connectedEdges.length
      const outgoers = nodes.filter(node => connectedEdges.some(edge => edge.target === node.id))
      const incomers = getIncomers(currentNode, nodes, edges)

      if (!streamInfo[currentNodeHandleKey]) {
        streamInfo[currentNodeHandleKey] = {
          upstreamNodes: new Set<string>(),
          downstreamEdges: new Set<string>(),
        }
      }

      if (nodeEdgesSet[currentNodeHandleKey]?.size > 0 && incomers.length > 1) {
        const newSet = new Set<string>()
        for (const item of totalEdgesSet) {
          if (!streamInfo[currentNodeHandleKey].downstreamEdges.has(item))
            newSet.add(item)
        }
        if (isEqual(nodeEdgesSet[currentNodeHandleKey], newSet)) {
          parallelListItem.depth = nodeParallelInfoMap[currentNode.id].depth
          nextNodeHandles.push({ node: currentNode, handle: currentHandle })
          break
        }
      }

      if (nodeParallelInfoMap[currentNode.id].depth > parallelListItem.depth)
        parallelListItem.depth = nodeParallelInfoMap[currentNode.id].depth

      outgoers.forEach((outgoer) => {
        const outgoerConnectedEdges = getConnectedEdges([outgoer], edges).filter(edge => edge.source === outgoer.id)
        const sourceEdgesGroup = groupBy(outgoerConnectedEdges, 'sourceHandle')
        const incomers = getIncomers(outgoer, nodes, edges)

        if (outgoers.length > 1 && incomers.length > 1)
          hasAbnormalEdges = true

        Object.keys(sourceEdgesGroup).forEach((sourceHandle) => {
          nextHandles.push({ node: outgoer, handle: sourceHandle })
        })
        if (!outgoerConnectedEdges.length)
          nextHandles.push({ node: outgoer, handle: 'source' })

        const outgoerKey = outgoer.id
        if (!nodeEdgesSet[outgoerKey])
          nodeEdgesSet[outgoerKey] = new Set<string>()

        if (nodeEdgesSet[currentNodeHandleKey]) {
          for (const item of nodeEdgesSet[currentNodeHandleKey])
            nodeEdgesSet[outgoerKey].add(item)
        }

        if (!streamInfo[outgoerKey]) {
          streamInfo[outgoerKey] = {
            upstreamNodes: new Set<string>(),
            downstreamEdges: new Set<string>(),
          }
        }

        if (!nodeParallelInfoMap[outgoer.id]) {
          nodeParallelInfoMap[outgoer.id] = {
            ...nodeParallelInfoMap[currentNode.id],
          }
        }

        if (connectedEdgesLength > 1) {
          const edge = connectedEdges.find(edge => edge.target === outgoer.id)!
          nodeEdgesSet[outgoerKey].add(edge.id)
          totalEdgesSet.add(edge.id)

          streamInfo[currentNodeHandleKey].downstreamEdges.add(edge.id)
          streamInfo[outgoerKey].upstreamNodes.add(currentNodeHandleKey)

          for (const item of streamInfo[currentNodeHandleKey].upstreamNodes)
            streamInfo[item].downstreamEdges.add(edge.id)

          if (!parallelListItem.parallelNodeId)
            parallelListItem.parallelNodeId = currentNode.id

          const prevDepth = nodeParallelInfoMap[currentNode.id].depth + 1
          const currentDepth = nodeParallelInfoMap[outgoer.id].depth

          nodeParallelInfoMap[outgoer.id].depth = Math.max(prevDepth, currentDepth)
        }
        else {
          for (const item of streamInfo[currentNodeHandleKey].upstreamNodes)
            streamInfo[outgoerKey].upstreamNodes.add(item)

          nodeParallelInfoMap[outgoer.id].depth = nodeParallelInfoMap[currentNode.id].depth
        }
      })
    }

    parallelList.push(parallelListItem)
  }

  while (nextNodeHandles.length) {
    const nodeHandle = nextNodeHandles.shift()!
    traverse(nodeHandle)
  }

  return {
    parallelList,
    hasAbnormalEdges,
  }
}

export const hasErrorHandleNode = (nodeType?: BlockEnum) => {
  return nodeType === BlockEnum.LLM || nodeType === BlockEnum.Tool || nodeType === BlockEnum.HttpRequest || nodeType === BlockEnum.Code
}

export const getEdgeColor = (nodeRunningStatus?: NodeRunningStatus, isFailBranch?: boolean) => {
  if (nodeRunningStatus === NodeRunningStatus.Succeeded)
    return 'var(--color-workflow-link-line-success-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Failed)
    return 'var(--color-workflow-link-line-error-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Exception)
    return 'var(--color-workflow-link-line-failure-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Running) {
    if (isFailBranch)
      return 'var(--color-workflow-link-line-failure-handle)'

    return 'var(--color-workflow-link-line-handle)'
  }

  return 'var(--color-workflow-link-line-normal)'
}

export const isExceptionVariable = (variable: string, nodeType?: BlockEnum) => {
  if ((variable === 'error_message' || variable === 'error_type') && hasErrorHandleNode(nodeType))
    return true

  return false
}

export const hasRetryNode = (nodeType?: BlockEnum) => {
  return nodeType === BlockEnum.LLM || nodeType === BlockEnum.Tool || nodeType === BlockEnum.HttpRequest || nodeType === BlockEnum.Code
}

export const getNodeCustomTypeByNodeDataType = (nodeType: BlockEnum) => {
  if (nodeType === BlockEnum.LoopEnd)
    return CUSTOM_SIMPLE_NODE
}
