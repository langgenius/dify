import {
  useCallback,
  useMemo,
} from 'react'
import { uniqBy } from 'lodash-es'
import { useTranslation } from 'react-i18next'
import {
  getIncomers,
  getOutgoers,
  useStoreApi,
} from 'reactflow'
import type {
  Connection,
} from 'reactflow'
import type {
  Edge,
  Node,
  ValueSelector,
} from '../types'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '../types'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  getParallelInfo,
} from '../utils'
import {
  PARALLEL_DEPTH_LIMIT,
  PARALLEL_LIMIT,
  SUPPORT_OUTPUT_VARS_NODE,
} from '../constants'
import { CUSTOM_NOTE_NODE } from '../note-node/constants'
import { findUsedVarNodes, getNodeOutputVars, updateNodeVars } from '../nodes/_base/components/variable/utils'
import { useNodesExtraData } from './use-nodes-data'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  fetchAllBuiltInTools,
  fetchAllCustomTools,
  fetchAllMCPTools,
  fetchAllWorkflowTools,
} from '@/service/tools'
import { CollectionType } from '@/app/components/tools/types'
import { CUSTOM_ITERATION_START_NODE } from '@/app/components/workflow/nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '@/app/components/workflow/nodes/loop-start/constants'
import { basePath } from '@/utils/var'
import { canFindTool } from '@/utils'

export const useIsChatMode = () => {
  const appDetail = useAppStore(s => s.appDetail)

  return appDetail?.mode === 'advanced-chat'
}

export const useWorkflow = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const nodesExtraData = useNodesExtraData()

  const getTreeLeafNodes = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    let startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const currentNode = nodes.find(node => node.id === nodeId)

    if (currentNode?.parentId)
      startNode = nodes.find(node => node.parentId === currentNode.parentId && (node.type === CUSTOM_ITERATION_START_NODE || node.type === CUSTOM_LOOP_START_NODE))

    if (!startNode)
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
    preOrder(startNode, (node) => {
      list.push(node)
    })

    const incomers = getIncomers({ id: nodeId } as Node, nodes, edges)

    list.push(...incomers)

    return uniqBy(list, 'id').filter((item: Node) => {
      return SUPPORT_OUTPUT_VARS_NODE.includes(item.data.type)
    })
  }, [store])

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

    if (currentNode.data.type === BlockEnum.Start)
      return true

    const checkPreviousNodes = (node: Node) => {
      const previousNodes = getBeforeNodeById(node.id)

      for (const prevNode of previousNodes) {
        if (prevNode.data.type === BlockEnum.Start)
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
    const afterNodes = getAfterNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(oldValeSelector, afterNodes)
    if (effectNodes.length > 0) {
      const newNodes = getNodes().map((node) => {
        if (effectNodes.find(n => n.id === node.id))
          return updateNodeVars(node, oldValeSelector, newVarSelector)

        return node
      })
      setNodes(newNodes)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const checkParallelLimit = useCallback((nodeId: string, nodeHandle = 'source') => {
    const {
      edges,
    } = store.getState()
    const connectedEdges = edges.filter(edge => edge.source === nodeId && edge.sourceHandle === nodeHandle)
    if (connectedEdges.length > PARALLEL_LIMIT - 1) {
      const { setShowTips } = workflowStore.getState()
      setShowTips(t('workflow.common.parallelTip.limit', { num: PARALLEL_LIMIT }))
      return false
    }

    return true
  }, [store, workflowStore, t])

  const checkNestedParallelLimit = useCallback((nodes: Node[], edges: Edge[], parentNodeId?: string) => {
    const {
      parallelList,
      hasAbnormalEdges,
    } = getParallelInfo(nodes, edges, parentNodeId)
    const { workflowConfig } = workflowStore.getState()

    if (hasAbnormalEdges)
      return false

    for (let i = 0; i < parallelList.length; i++) {
      const parallel = parallelList[i]

      if (parallel.depth > (workflowConfig?.parallel_depth_limit || PARALLEL_DEPTH_LIMIT)) {
        const { setShowTips } = workflowStore.getState()
        setShowTips(t('workflow.common.parallelTip.depthLimit', { num: (workflowConfig?.parallel_depth_limit || PARALLEL_DEPTH_LIMIT) }))
        return false
      }
    }

    return true
  }, [t, workflowStore])

  const isValidConnection = useCallback(({ source, sourceHandle, target }: Connection) => {
    const {
      edges,
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const sourceNode: Node = nodes.find(node => node.id === source)!
    const targetNode: Node = nodes.find(node => node.id === target)!

    if (!checkParallelLimit(source!, sourceHandle || 'source'))
      return false

    if (sourceNode.type === CUSTOM_NOTE_NODE || targetNode.type === CUSTOM_NOTE_NODE)
      return false

    if (sourceNode.parentId !== targetNode.parentId)
      return false

    if (sourceNode && targetNode) {
      const sourceNodeAvailableNextNodes = nodesExtraData[sourceNode.data.type].availableNextNodes
      const targetNodeAvailablePrevNodes = [...nodesExtraData[targetNode.data.type].availablePrevNodes, BlockEnum.Start]

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
  }, [store, nodesExtraData, checkParallelLimit])

  const getNode = useCallback((nodeId?: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    return nodes.find(node => node.id === nodeId) || nodes.find(node => node.data.type === BlockEnum.Start)
  }, [store])

  return {
    getTreeLeafNodes,
    getBeforeNodesInSameBranch,
    getBeforeNodesInSameBranchIncludeParent,
    getAfterNodesInSameBranch,
    handleOutVarRenameChange,
    isVarUsedInNodes,
    removeUsedVarInNodes,
    isNodeVarsUsedInNodes,
    checkParallelLimit,
    checkNestedParallelLimit,
    isValidConnection,
    isFromStartNode,
    getNode,
    getBeforeNodeById,
    getIterationNodeChildren,
    getLoopNodeChildren,
  }
}

export const useFetchToolsData = () => {
  const workflowStore = useWorkflowStore()

  const handleFetchAllTools = useCallback(async (type: string) => {
    if (type === 'builtin') {
      const buildInTools = await fetchAllBuiltInTools()

      if (basePath) {
        buildInTools.forEach((item) => {
          if (typeof item.icon == 'string' && !item.icon.includes(basePath))
            item.icon = `${basePath}${item.icon}`
        })
      }
      workflowStore.setState({
        buildInTools: buildInTools || [],
      })
    }
    if (type === 'custom') {
      const customTools = await fetchAllCustomTools()

      workflowStore.setState({
        customTools: customTools || [],
      })
    }
    if (type === 'workflow') {
      const workflowTools = await fetchAllWorkflowTools()

      workflowStore.setState({
        workflowTools: workflowTools || [],
      })
    }
    if(type === 'mcp') {
      const mcpTools = await fetchAllMCPTools()

      workflowStore.setState({
        mcpTools: mcpTools || [],
      })
    }
  }, [workflowStore])

  return {
    handleFetchAllTools,
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

  const getNodesReadOnly = useCallback(() => {
    const {
      workflowRunningData,
      historyWorkflowData,
      isRestoring,
    } = workflowStore.getState()

    return workflowRunningData?.result.status === WorkflowRunningStatus.Running || historyWorkflowData || isRestoring
  }, [workflowStore])

  return {
    nodesReadOnly: !!(workflowRunningData?.result.status === WorkflowRunningStatus.Running || historyWorkflowData || isRestoring),
    getNodesReadOnly,
  }
}

export const useToolIcon = (data: Node['data']) => {
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const mcpTools = useStore(s => s.mcpTools)

  const toolIcon = useMemo(() => {
    if(!data)
      return ''
    if (data.type === BlockEnum.Tool) {
      let targetTools = buildInTools
      if (data.provider_type === CollectionType.builtIn)
        targetTools = buildInTools
      else if (data.provider_type === CollectionType.custom)
        targetTools = customTools
      else if (data.provider_type === CollectionType.mcp)
        targetTools = mcpTools
      else
        targetTools = workflowTools
      return targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.icon
    }
  }, [data, buildInTools, customTools, mcpTools, workflowTools])

  return toolIcon
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
