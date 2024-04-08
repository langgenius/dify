import {
  Position,
  getConnectedEdges,
  getOutgoers,
} from 'reactflow'
import dagre from 'dagre'
import {
  cloneDeep,
  uniqBy,
} from 'lodash-es'
import type {
  Edge,
  InputVar,
  Node,
  ToolWithProvider,
} from './types'
import { BlockEnum } from './types'
import {
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from './constants'
import type { QuestionClassifierNodeType } from './nodes/question-classifier/types'
import type { ToolNodeType } from './nodes/tool/types'
import { CollectionType } from '@/app/components/tools/types'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'

export const initialNodes = (nodes: Node[], edges: Edge[]) => {
  const firstNode = nodes[0]

  if (!firstNode?.position) {
    nodes.forEach((node, index) => {
      node.position = {
        x: START_INITIAL_POSITION.x + index * NODE_WIDTH_X_OFFSET,
        y: START_INITIAL_POSITION.y,
      }
    })
  }
  return nodes.map((node) => {
    node.type = 'custom'

    const connectedEdges = getConnectedEdges([node], edges)
    node.data._connectedSourceHandleIds = connectedEdges.filter(edge => edge.source === node.id).map(edge => edge.sourceHandle || 'source')
    node.data._connectedTargetHandleIds = connectedEdges.filter(edge => edge.target === node.id).map(edge => edge.targetHandle || 'target')

    if (node.data.type === BlockEnum.IfElse) {
      node.data._targetBranches = [
        {
          id: 'true',
          name: 'IS TRUE',
        },
        {
          id: 'false',
          name: 'IS FALSE',
        },
      ]
    }

    if (node.data.type === BlockEnum.QuestionClassifier) {
      node.data._targetBranches = (node.data as QuestionClassifierNodeType).classes.map((topic) => {
        return topic
      })
    }

    return node
  })
}

export const initialEdges = (edges: Edge[], nodes: Node[]) => {
  let selectedNode: Node | null = null
  const nodesMap = nodes.reduce((acc, node) => {
    acc[node.id] = node

    if (node.data?.selected)
      selectedNode = node

    return acc
  }, {} as Record<string, Node>)
  return edges.map((edge) => {
    edge.type = 'custom'

    if (!edge.sourceHandle)
      edge.sourceHandle = 'source'

    if (!edge.targetHandle)
      edge.targetHandle = 'target'

    if (!edge.data?.sourceType) {
      edge.data = {
        ...edge.data,
        sourceType: nodesMap[edge.source].data.type!,
      } as any
    }

    if (!edge.data?.targetType) {
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

const dagreGraph = new dagre.graphlib.Graph()
dagreGraph.setDefaultEdgeLabel(() => ({}))
export const getLayoutByDagre = (originNodes: Node[], originEdges: Edge[]) => {
  const nodes = cloneDeep(originNodes)
  const edges = cloneDeep(originEdges)
  dagreGraph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 64,
    ranksep: 40,
  })
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: node.width, height: node.height })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

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
    nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] || {
      _connectedSourceHandleIds: [...(sourceNode?.data._connectedSourceHandleIds || [])],
      _connectedTargetHandleIds: [...(sourceNode?.data._connectedTargetHandleIds || [])],
    }
    const targetNode = nodes.find(node => node.id === edge.target)!
    nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] || {
      _connectedSourceHandleIds: [...(targetNode?.data._connectedSourceHandleIds || [])],
      _connectedTargetHandleIds: [...(targetNode?.data._connectedTargetHandleIds || [])],
    }

    if (sourceNode) {
      if (type === 'remove')
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.filter((handleId: string) => handleId !== edge.sourceHandle)

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.push(edge.sourceHandle || 'source')
    }

    if (targetNode) {
      if (type === 'remove')
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.filter((handleId: string) => handleId !== edge.targetHandle)

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.push(edge.targetHandle || 'target')
    }
  })

  return nodesConnectedSourceOrTargetHandleIdsMap
}

export const generateNewNode = ({ data, position, id }: Pick<Node, 'data' | 'position'> & { id?: string }) => {
  return {
    id: id || `${Date.now()}`,
    type: 'custom',
    data,
    position,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
  } as Node
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
        traverse(outgoer, depth + 1)
      })
    }
    else {
      list.push(root)
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
  language: string,
) => {
  const { provider_id, provider_type, tool_name } = toolData
  const isBuiltIn = provider_type === CollectionType.builtIn
  const currentTools = isBuiltIn ? buildInTools : customTools
  const currCollection = currentTools.find(item => item.id === provider_id)
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
