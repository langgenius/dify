import produce from 'immer'
import {
  getConnectedEdges,
  getOutgoers,
} from 'reactflow'
import dagre from 'dagre'
import type {
  Edge,
  Node,
} from './types'
import { BlockEnum } from './types'
import type { QuestionClassifierNodeType } from './nodes/question-classifier/types'

export const nodesLevelOrderTraverse = (
  firstNode: Node,
  nodes: Node[],
  edges: Edge[],
  callback: (n: any) => void,
) => {
  const queue = [{
    node: firstNode,
    depth: 0,
    breath: 0,
  }]

  let currenDepth = 0
  let currentBreath = 0
  while (queue.length) {
    const { node, depth, breath } = queue.shift()!

    if (currenDepth !== depth) {
      currenDepth = depth
      currentBreath = 0
    }

    callback({ node, depth, breath })

    const targetBranches = node.data._targetBranches
    if (targetBranches?.length) {
      const targetEdges = getConnectedEdges([node], edges)

      if (targetEdges.length) {
        const sortedTargetEdges = targetEdges
          .filter(edge => edge.source === node.id)
          .sort((a, b) => {
            const aIndex = targetBranches.findIndex(branch => branch.id === a.sourceHandle)
            const bIndex = targetBranches.findIndex(branch => branch.id === b.sourceHandle)

            return aIndex - bIndex
          })

        const outgoers = getOutgoers(node, nodes, sortedTargetEdges)

        queue.push(...outgoers.map((outgoer, index) => {
          return {
            node: outgoer,
            depth: depth + 1,
            breath: currentBreath + index,
          }
        }))

        currentBreath += outgoers.length
      }
      else {
        currentBreath += 1
      }
    }
    else {
      const outgoers = getOutgoers(node, nodes, edges)

      if (outgoers.length === 1) {
        queue.push({
          node: outgoers[0],
          depth: depth + 1,
          breath: 0,
        })
      }

      currentBreath += 1
    }
  }
}

export const initialNodes = (nodes: Node[]) => {
  const newNodes = produce(nodes, (draft) => {
    draft.forEach((node) => {
      node.type = 'custom'

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
    })
  })

  return newNodes
}

export const initialEdges = (edges: Edge[]) => {
  const newEdges = produce(edges, (draft) => {
    draft.forEach((edge) => {
      edge.type = 'custom'
    })
  })

  return newEdges
}

export type PositionMap = {
  index: {
    x: number
    y: number
  }
}

export const getNodesPositionMap = (nodes: Node[], edges: Edge[]) => {
  const startNode = nodes.find((node: Node) => node.data.type === BlockEnum.Start)
  const positionMap: Record<string, PositionMap> = {}

  if (startNode) {
    nodesLevelOrderTraverse(startNode, nodes, edges, ({ node, depth, breath }) => {
      positionMap[node.id] = {
        index: {
          x: depth,
          y: breath,
        },
      }
    })
  }

  return positionMap
}

export const getLayoutByDagre = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 64,
    ranksep: 64,
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

export const getVariables = () => {

}
