import type {
  Connection,
} from 'reactflow'
import type { IterationNodeType } from '../nodes/iteration/types'
import type { LoopNodeType } from '../nodes/loop/types'
import type {
  BlockEnum,
  Edge,
  Node,
  ValueSelector,
} from '../types'
import { uniqBy } from 'es-toolkit/compat'
import {
  useCallback,
} from 'react'
import {
  getIncomers,
  getOutgoers,
  useStoreApi,
} from 'reactflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { CUSTOM_ITERATION_START_NODE } from '@/app/components/workflow/nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '@/app/components/workflow/nodes/loop-start/constants'
import { AppModeEnum } from '@/types/app'
import { useNodesMetaData } from '.'
import {
  SUPPORT_OUTPUT_VARS_NODE,
} from '../constants'
import { findUsedVarNodes, getNodeOutputVars, updateNodeVars } from '../nodes/_base/components/variable/utils'
import { CUSTOM_NOTE_NODE } from '../note-node/constants'

import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  WorkflowRunningStatus,
} from '../types'
import {
  getWorkflowEntryNode,
  isWorkflowEntryNode,
} from '../utils/workflow-entry'
import { useAvailableBlocks } from './use-available-blocks'

export const useIsChatMode = () => {
  const appDetail = useAppStore(s => s.appDetail)

  return appDetail?.mode === AppModeEnum.ADVANCED_CHAT
}

export const useWorkflow = () => {
  const store = useStoreApi()
  const { getAvailableBlocks } = useAvailableBlocks()
  const { nodesMap } = useNodesMetaData()

  const getNodeById = useCallback((nodeId: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)
    return currentNode
  }, [store])

  const getTreeLeafNodes = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    // let startNode = getWorkflowEntryNode(nodes)
    const currentNode = nodes.find(node => node.id === nodeId)

    let startNodes = nodes.filter(node => nodesMap?.[node.data.type as BlockEnum]?.metaData.isStart) || []

    if (currentNode?.parentId) {
      const startNode = nodes.find(node => node.parentId === currentNode.parentId && (node.type === CUSTOM_ITERATION_START_NODE || node.type === CUSTOM_LOOP_START_NODE))
      if (startNode)
        startNodes = [startNode]
    }

    if (!startNodes.length)
      return []

    const list: Node[] = []
    const preOrder = (root: Node, callback: (node: Node) => void) => {
      if (root.id === nodeId)
        return
      const outgoers = getOutgoers(root, nodes, edges)

      if (outgoers.length) {
        outgoers.forEach((outgoer) => {
          preOrder(outgoer, callback)
        })
      }
      else {
        if (root.id !== nodeId)
          callback(root)
      }
    }
    startNodes.forEach((startNode) => {
      preOrder(startNode, (node) => {
        list.push(node)
      })
    })

    const incomers = getIncomers({ id: nodeId } as Node, nodes, edges)

    list.push(...incomers)

    return uniqBy(list, 'id').filter((item: Node) => {
      return SUPPORT_OUTPUT_VARS_NODE.includes(item.data.type)
    })
  }, [store, nodesMap])

  const getBeforeNodesInSameBranch = useCallback((nodeId: string, newNodes?: Node[], newEdges?: Edge[]) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = newNodes || getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)

    const list: Node[] = []

    if (!currentNode)
      return list

    if (currentNode.parentId) {
      const parentNode = nodes.find(node => node.id === currentNode.parentId)
      if (parentNode) {
        const parentList = getBeforeNodesInSameBranch(parentNode.id)

        list.push(...parentList)
      }
    }

    const traverse = (root: Node, callback: (node: Node) => void) => {
      if (root) {
        const incomers = getIncomers(root, nodes, newEdges || edges)

        if (incomers.length) {
          incomers.forEach((node) => {
            if (!list.find(n => node.id === n.id)) {
              callback(node)
              traverse(node, callback)
            }
          })
        }
      }
    }
    traverse(currentNode, (node) => {
      list.push(node)
    })

    const length = list.length
    if (length) {
      return uniqBy(list, 'id').reverse().filter((item: Node) => {
        return SUPPORT_OUTPUT_VARS_NODE.includes(item.data.type)
      })
    }

    return []
  }, [store])

  const getBeforeNodesInSameBranchIncludeParent = useCallback((nodeId: string, newNodes?: Node[], newEdges?: Edge[]) => {
    const nodes = getBeforeNodesInSameBranch(nodeId, newNodes, newEdges)
    const {
      getNodes,
    } = store.getState()
    const allNodes = getNodes()
    const node = allNodes.find(n => n.id === nodeId)
    const parentNodeId = node?.parentId
    const parentNode = allNodes.find(n => n.id === parentNodeId)
    if (parentNode)
      nodes.push(parentNode)

    return nodes
  }, [getBeforeNodesInSameBranch, store])

  const getAfterNodesInSameBranch = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)!

    if (!currentNode)
      return []
    const list: Node[] = [currentNode]

    const traverse = (root: Node, callback: (node: Node) => void) => {
      if (root) {
        const outgoers = getOutgoers(root, nodes, edges)

        if (outgoers.length) {
          outgoers.forEach((node) => {
            callback(node)
            traverse(node, callback)
          })
        }
      }
    }
    traverse(currentNode, (node) => {
      list.push(node)
    })

    return uniqBy(list, 'id')
  }, [store])

  const getBeforeNodeById = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const node = nodes.find(node => node.id === nodeId)!

    return getIncomers(node, nodes, edges)
  }, [store])

  const getIterationNodeChildren = useCallback((nodeId: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()

    return nodes.filter(node => node.parentId === nodeId)
  }, [store])

  const getLoopNodeChildren = useCallback((nodeId: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()

    return nodes.filter(node => node.parentId === nodeId)
  }, [store])

  const isFromStartNode = useCallback((nodeId: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)

    if (!currentNode)
      return false

    if (isWorkflowEntryNode(currentNode.data.type))
      return true

    const checkPreviousNodes = (node: Node) => {
      const previousNodes = getBeforeNodeById(node.id)

      for (const prevNode of previousNodes) {
        if (isWorkflowEntryNode(prevNode.data.type))
          return true
        if (checkPreviousNodes(prevNode))
          return true
      }

      return false
    }

    return checkPreviousNodes(currentNode)
  }, [store, getBeforeNodeById])

  const handleOutVarRenameChange = useCallback((nodeId: string, oldValeSelector: ValueSelector, newVarSelector: ValueSelector) => {
    const { getNodes, setNodes } = store.getState()
    const allNodes = getNodes()
    const affectedNodes = findUsedVarNodes(oldValeSelector, allNodes)
    if (affectedNodes.length > 0) {
      const newNodes = allNodes.map((node) => {
        if (affectedNodes.find(n => n.id === node.id))
          return updateNodeVars(node, oldValeSelector, newVarSelector)

        return node
      })
      setNodes(newNodes)
    }
  }, [store])

  const isVarUsedInNodes = useCallback((varSelector: ValueSelector) => {
    const nodeId = varSelector[0]
    const afterNodes = getAfterNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(varSelector, afterNodes)
    return effectNodes.length > 0
  }, [getAfterNodesInSameBranch])

  const removeUsedVarInNodes = useCallback((varSelector: ValueSelector) => {
    const nodeId = varSelector[0]
    const { getNodes, setNodes } = store.getState()
    const afterNodes = getAfterNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(varSelector, afterNodes)
    if (effectNodes.length > 0) {
      const newNodes = getNodes().map((node) => {
        if (effectNodes.find(n => n.id === node.id))
          return updateNodeVars(node, varSelector, [])

        return node
      })
      setNodes(newNodes)
    }
  }, [getAfterNodesInSameBranch, store])

  const isNodeVarsUsedInNodes = useCallback((node: Node, isChatMode: boolean) => {
    const outputVars = getNodeOutputVars(node, isChatMode)
    const isUsed = outputVars.some((varSelector) => {
      return isVarUsedInNodes(varSelector)
    })
    return isUsed
  }, [isVarUsedInNodes])

  const getRootNodesById = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)

    const rootNodes: Node[] = []

    if (!currentNode)
      return rootNodes

    if (currentNode.parentId) {
      const parentNode = nodes.find(node => node.id === currentNode.parentId)
      if (parentNode) {
        const parentList = getRootNodesById(parentNode.id)

        rootNodes.push(...parentList)
      }
    }

    const traverse = (root: Node, callback: (node: Node) => void) => {
      if (root) {
        const incomers = getIncomers(root, nodes, edges)

        if (incomers.length) {
          incomers.forEach((node) => {
            traverse(node, callback)
          })
        }
        else {
          callback(root)
        }
      }
    }
    traverse(currentNode, (node) => {
      rootNodes.push(node)
    })

    const length = rootNodes.length
    if (length)
      return uniqBy(rootNodes, 'id')

    return []
  }, [store])

  const getStartNodes = useCallback((nodes: Node[], currentNode?: Node) => {
    const { id, parentId } = currentNode || {}
    let startNodes: Node[] = []

    if (parentId) {
      const parentNode = nodes.find(node => node.id === parentId)
      if (!parentNode)
        throw new Error('Parent node not found')

      const startNode = nodes.find(node => node.id === (parentNode.data as (IterationNodeType | LoopNodeType)).start_node_id)
      if (startNode)
        startNodes = [startNode]
    }
    else {
      startNodes = nodes.filter(node => nodesMap?.[node.data.type as BlockEnum]?.metaData.isStart) || []
    }

    if (!startNodes.length)
      startNodes = getRootNodesById(id || '')

    return startNodes
  }, [nodesMap, getRootNodesById])

  const isValidConnection = useCallback(({ source, sourceHandle: _sourceHandle, target }: Connection) => {
    const {
      edges,
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const sourceNode: Node = nodes.find(node => node.id === source)!
    const targetNode: Node = nodes.find(node => node.id === target)!

    if (sourceNode.type === CUSTOM_NOTE_NODE || targetNode.type === CUSTOM_NOTE_NODE)
      return false

    if (sourceNode.parentId !== targetNode.parentId)
      return false

    if (sourceNode && targetNode) {
      const sourceNodeAvailableNextNodes = getAvailableBlocks(sourceNode.data.type, !!sourceNode.parentId).availableNextBlocks
      const targetNodeAvailablePrevNodes = getAvailableBlocks(targetNode.data.type, !!targetNode.parentId).availablePrevBlocks

      if (!sourceNodeAvailableNextNodes.includes(targetNode.data.type))
        return false

      if (!targetNodeAvailablePrevNodes.includes(sourceNode.data.type))
        return false
    }

    const hasCycle = (node: Node, visited = new Set()) => {
      if (visited.has(node.id))
        return false

      visited.add(node.id)

      for (const outgoer of getOutgoers(node, nodes, edges)) {
        if (outgoer.id === source)
          return true
        if (hasCycle(outgoer, visited))
          return true
      }
    }

    return !hasCycle(targetNode)
  }, [store, getAvailableBlocks])

  const getNode = useCallback((nodeId?: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    return nodes.find(node => node.id === nodeId) || getWorkflowEntryNode(nodes)
  }, [store])

  return {
    getNodeById,
    getTreeLeafNodes,
    getBeforeNodesInSameBranch,
    getBeforeNodesInSameBranchIncludeParent,
    getAfterNodesInSameBranch,
    handleOutVarRenameChange,
    isVarUsedInNodes,
    removeUsedVarInNodes,
    isNodeVarsUsedInNodes,
    isValidConnection,
    getBeforeNodeById,
    getIterationNodeChildren,
    getLoopNodeChildren,
    getRootNodesById,
    getStartNodes,
    isFromStartNode,
    getNode,
  }
}

export const useWorkflowReadOnly = () => {
  const workflowStore = useWorkflowStore()
  const workflowRunningData = useStore(s => s.workflowRunningData)

  const getWorkflowReadOnly = useCallback(() => {
    return workflowStore.getState().workflowRunningData?.result.status === WorkflowRunningStatus.Running
  }, [workflowStore])

  return {
    workflowReadOnly: workflowRunningData?.result.status === WorkflowRunningStatus.Running,
    getWorkflowReadOnly,
  }
}

export const useNodesReadOnly = () => {
  const workflowStore = useWorkflowStore()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const isRestoring = useStore(s => s.isRestoring)

  const getNodesReadOnly = useCallback((): boolean => {
    const {
      workflowRunningData,
      historyWorkflowData,
      isRestoring,
    } = workflowStore.getState()

    return !!(workflowRunningData?.result.status === WorkflowRunningStatus.Running || historyWorkflowData || isRestoring)
  }, [workflowStore])

  return {
    nodesReadOnly: !!(workflowRunningData?.result.status === WorkflowRunningStatus.Running || historyWorkflowData || isRestoring),
    getNodesReadOnly,
  }
}

export const useIsNodeInIteration = (iterationId: string) => {
  const store = useStoreApi()

  const isNodeInIteration = useCallback((nodeId: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const node = nodes.find(node => node.id === nodeId)

    if (!node)
      return false

    if (node.parentId === iterationId)
      return true

    return false
  }, [iterationId, store])
  return {
    isNodeInIteration,
  }
}

export const useIsNodeInLoop = (loopId: string) => {
  const store = useStoreApi()

  const isNodeInLoop = useCallback((nodeId: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const node = nodes.find(node => node.id === nodeId)

    if (!node)
      return false

    if (node.parentId === loopId)
      return true

    return false
  }, [loopId, store])
  return {
    isNodeInLoop,
  }
}
