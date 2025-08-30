import {
  getConnectedEdges,
} from 'reactflow'
import {
  cloneDeep,
} from 'lodash-es'
import type {
  Edge,
  Node,
} from '../types'
import {
  BlockEnum,
  ErrorHandleMode,
} from '../types'
import {
  CUSTOM_NODE,
  DEFAULT_RETRY_INTERVAL,
  DEFAULT_RETRY_MAX,
  ITERATION_CHILDREN_Z_INDEX,
  LOOP_CHILDREN_Z_INDEX,
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '../constants'
import { CUSTOM_ITERATION_START_NODE } from '../nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '../nodes/loop-start/constants'
import type { QuestionClassifierNodeType } from '../nodes/question-classifier/types'
import type { IfElseNodeType } from '../nodes/if-else/types'
import { branchNameCorrect } from '../nodes/if-else/utils'
import type { IterationNodeType } from '../nodes/iteration/types'
import type { LoopNodeType } from '../nodes/loop/types'
import type { ToolNodeType } from '../nodes/tool/types'
import {
  getIterationStartNode,
  getLoopStartNode,
} from '.'
import { correctModelProvider } from '@/utils'

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

export const preprocessNodesAndEdges = (nodes: Node[], edges: Edge[]) => {
  const hasIterationNode = nodes.some(node => node.data.type === BlockEnum.Iteration)
  const hasLoopNode = nodes.some(node => node.data.type === BlockEnum.Loop)

  if (!hasIterationNode && !hasLoopNode) {
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

    if (node.data.type === BlockEnum.Tool && !(node as Node<ToolNodeType>).data.version && !(node as Node<ToolNodeType>).data.tool_node_version) {
      (node as Node<ToolNodeType>).data.tool_node_version = '2'

      const toolConfigurations = (node as Node<ToolNodeType>).data.tool_configurations
      if (toolConfigurations && Object.keys(toolConfigurations).length > 0) {
        const newValues = { ...toolConfigurations }
        Object.keys(toolConfigurations).forEach((key) => {
          if (typeof toolConfigurations[key] !== 'object' || toolConfigurations[key] === null) {
            newValues[key] = {
              type: 'constant',
              value: toolConfigurations[key],
            }
          }
        });
        (node as Node<ToolNodeType>).data.tool_configurations = newValues
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
