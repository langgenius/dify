import type { CustomGroupNodeData } from '../custom-group-node'
import type { GroupNodeData } from '../nodes/group/types'
import type { IfElseNodeType } from '../nodes/if-else/types'
import type { IterationNodeType } from '../nodes/iteration/types'
import type { LoopNodeType } from '../nodes/loop/types'
import type { QuestionClassifierNodeType } from '../nodes/question-classifier/types'
import type { ToolNodeType } from '../nodes/tool/types'
import type {
  Edge,
  Node,
} from '../types'
import { cloneDeep } from 'es-toolkit/object'
import {
  getConnectedEdges,
} from 'reactflow'
import { getIterationStartNode, getLoopStartNode } from '@/app/components/workflow/utils/node'
import { correctModelProvider } from '@/utils'
import {
  CUSTOM_NODE,
  DEFAULT_RETRY_INTERVAL,
  DEFAULT_RETRY_MAX,
  ITERATION_CHILDREN_Z_INDEX,
  LOOP_CHILDREN_Z_INDEX,
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '../constants'
import {
  CUSTOM_GROUP_NODE,
  GROUP_CHILDREN_Z_INDEX,
} from '../custom-group-node'
import { branchNameCorrect } from '../nodes/if-else/utils'
import { CUSTOM_ITERATION_START_NODE } from '../nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '../nodes/loop-start/constants'
import {
  BlockEnum,
  ErrorHandleMode,
} from '../types'

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
  const hasGroupNode = nodes.some(node => node.type === CUSTOM_GROUP_NODE)
  const hasBusinessGroupNode = nodes.some(node => node.data.type === BlockEnum.Group)

  if (!hasIterationNode && !hasLoopNode && !hasGroupNode && !hasBusinessGroupNode) {
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

  // Derive Group internal edges (input → entries, leaves → exits)
  const groupInternalEdges: Edge[] = []
  const groupNodes = nodes.filter(node => node.type === CUSTOM_GROUP_NODE)

  for (const groupNode of groupNodes) {
    const groupData = groupNode.data as unknown as CustomGroupNodeData
    const { group } = groupData

    if (!group)
      continue

    const { inputNodeId, entryNodeIds, exitPorts } = group

    // Derive edges: input → each entry node
    for (const entryId of entryNodeIds) {
      const entryNode = nodesMap[entryId]
      if (entryNode) {
        groupInternalEdges.push({
          id: `group-internal-${inputNodeId}-source-${entryId}-target`,
          type: 'custom',
          source: inputNodeId,
          sourceHandle: 'source',
          target: entryId,
          targetHandle: 'target',
          data: {
            sourceType: '' as any, // Group input has empty type
            targetType: entryNode.data.type,
            _isGroupInternal: true,
            _groupId: groupNode.id,
          },
          zIndex: GROUP_CHILDREN_Z_INDEX,
        } as Edge)
      }
    }

    // Derive edges: each leaf node → exit port
    for (const exitPort of exitPorts) {
      const leafNode = nodesMap[exitPort.leafNodeId]
      if (leafNode) {
        groupInternalEdges.push({
          id: `group-internal-${exitPort.leafNodeId}-${exitPort.sourceHandle}-${exitPort.portNodeId}-target`,
          type: 'custom',
          source: exitPort.leafNodeId,
          sourceHandle: exitPort.sourceHandle,
          target: exitPort.portNodeId,
          targetHandle: 'target',
          data: {
            sourceType: leafNode.data.type,
            targetType: '' as any, // Exit port has empty type
            _isGroupInternal: true,
            _groupId: groupNode.id,
          },
          zIndex: GROUP_CHILDREN_Z_INDEX,
        } as Edge)
      }
    }
  }

  // Rebuild isTemp edges for business Group nodes (BlockEnum.Group)
  // These edges connect the group node to external nodes for visual display
  const groupTempEdges: Edge[] = []
  const inboundEdgeIds = new Set<string>()

  nodes.forEach((groupNode) => {
    if (groupNode.data.type !== BlockEnum.Group)
      return

    const groupData = groupNode.data as GroupNodeData
    const { members = [], headNodeIds = [], leafNodeIds = [], handlers = [] } = groupData
    const memberSet = new Set(members.map(m => m.id))
    const headSet = new Set(headNodeIds)
    const leafSet = new Set(leafNodeIds)

    edges.forEach((edge) => {
      // Inbound edge: source outside group, target is a head node
      // Use Set to dedupe since multiple head nodes may share same external source
      if (!memberSet.has(edge.source) && headSet.has(edge.target)) {
        const sourceHandle = edge.sourceHandle || 'source'
        const edgeId = `${edge.source}-${sourceHandle}-${groupNode.id}-target`
        if (!inboundEdgeIds.has(edgeId)) {
          inboundEdgeIds.add(edgeId)
          groupTempEdges.push({
            id: edgeId,
            type: 'custom',
            source: edge.source,
            sourceHandle,
            target: groupNode.id,
            targetHandle: 'target',
            data: {
              sourceType: edge.data?.sourceType,
              targetType: BlockEnum.Group,
              _isTemp: true,
            },
          } as Edge)
        }
      }

      // Outbound edge: source is a leaf node, target outside group
      if (leafSet.has(edge.source) && !memberSet.has(edge.target)) {
        const edgeSourceHandle = edge.sourceHandle || 'source'
        const handler = handlers.find(
          h => h.nodeId === edge.source && h.sourceHandle === edgeSourceHandle,
        )
        if (handler) {
          groupTempEdges.push({
            id: `${groupNode.id}-${handler.id}-${edge.target}-${edge.targetHandle}`,
            type: 'custom',
            source: groupNode.id,
            sourceHandle: handler.id,
            target: edge.target!,
            targetHandle: edge.targetHandle,
            data: {
              sourceType: BlockEnum.Group,
              targetType: edge.data?.targetType,
              _isTemp: true,
            },
          } as Edge)
        }
      }
    })
  })

  return {
    nodes: [...nodes, ...newIterationStartNodes, ...newLoopStartNodes],
    edges: [...edges, ...newEdges, ...groupInternalEdges, ...groupTempEdges],
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
  }, {} as Record<string, { nodeId: string, nodeType: BlockEnum }[]>)

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
      // delete conditions and logical_operator if cases is not empty
      if (nodeData.cases.length > 0 && nodeData.conditions && nodeData.logical_operator) {
        delete nodeData.conditions
        delete nodeData.logical_operator
      }
    }

    if (node.data.type === BlockEnum.QuestionClassifier) {
      node.data._targetBranches = (node.data as QuestionClassifierNodeType).classes.map((topic) => {
        return topic
      })
    }

    if (node.data.type === BlockEnum.Group) {
      const groupData = node.data as GroupNodeData
      if (groupData.handlers?.length) {
        node.data._targetBranches = groupData.handlers.map(handler => ({
          id: handler.id,
          name: handler.label || handler.id,
        }))
      }
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
