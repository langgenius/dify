import {
  useCallback,
  useEffect,
} from 'react'
import { uniqBy } from 'lodash-es'
import useSWR from 'swr'
import produce from 'immer'
import {
  getIncomers,
  getOutgoers,
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import type { Connection } from 'reactflow'
import type { ToolsMap } from '../block-selector/types'
import {
  generateNewNode,
  getLayoutByDagre,
} from '../utils'
import type { Node } from '../types'
import { BlockEnum } from '../types'
import { useWorkflowStore } from '../store'
import {
  AUTO_LAYOUT_OFFSET,
  START_INITIAL_POSITION,
  SUPPORT_OUTPUT_VARS_NODE,
} from '../constants'
import {
  useNodesExtraData,
  useNodesInitialData,
} from './use-nodes-data'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  fetchNodesDefaultConfigs,
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import { fetchCollectionList } from '@/service/tools'

export const useIsChatMode = () => {
  const appDetail = useAppStore(s => s.appDetail)

  return appDetail?.mode === 'advanced-chat'
}

export const useWorkflow = () => {
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const nodesExtraData = useNodesExtraData()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleLayout = useCallback(async () => {
    const {
      getNodes,
      edges,
      setNodes,
    } = store.getState()
    const { setViewport } = reactflow
    const nodes = getNodes()
    const layout = getLayoutByDagre(nodes, edges)

    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        const nodeWithPosition = layout.node(node.id)
        node.position = {
          x: nodeWithPosition.x + AUTO_LAYOUT_OFFSET.x,
          y: nodeWithPosition.y + AUTO_LAYOUT_OFFSET.y,
        }
      })
    })
    setNodes(newNodes)
    setViewport({
      x: 0,
      y: 0,
      zoom: 0.8,
    })
    setTimeout(() => handleSyncWorkflowDraft())
  }, [store, reactflow, handleSyncWorkflowDraft])

  const getTreeLeafNodes = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)

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

    return uniqBy(list, 'id').filter((item) => {
      return SUPPORT_OUTPUT_VARS_NODE.includes(item.data.type)
    })
  }, [store])

  const getBeforeNodesInSameBranch = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)
    const list: Node[] = []

    if (!currentNode)
      return list

    const traverse = (root: Node, callback: (node: Node) => void) => {
      if (root) {
        const incomers = getIncomers(root, nodes, edges)

        if (incomers.length) {
          incomers.forEach((node) => {
            callback(node)
            traverse(node, callback)
          })
        }
      }
    }
    traverse(currentNode, (node) => {
      list.push(node)
    })

    const length = list.length
    if (length) {
      return uniqBy(list, 'id').reverse().filter((item) => {
        return SUPPORT_OUTPUT_VARS_NODE.includes(item.data.type)
      })
    }

    return []
  }, [store])

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

  const isValidConnection = useCallback(({ source, target }: Connection) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const sourceNode: Node = nodes.find(node => node.id === source)!
    const targetNode: Node = nodes.find(node => node.id === target)!

    if (sourceNode && targetNode) {
      const sourceNodeAvailableNextNodes = nodesExtraData[sourceNode.data.type].availableNextNodes
      const targetNodeAvailablePrevNodes = [...nodesExtraData[targetNode.data.type].availablePrevNodes, BlockEnum.Start]
      if (!sourceNodeAvailableNextNodes.includes(targetNode.data.type))
        return false

      if (!targetNodeAvailablePrevNodes.includes(sourceNode.data.type))
        return false
    }

    return true
  }, [store, nodesExtraData])

  return {
    handleLayout,
    getTreeLeafNodes,
    getBeforeNodesInSameBranch,
    getAfterNodesInSameBranch,
    isValidConnection,
  }
}

export const useWorkflowInit = () => {
  const workflowStore = useWorkflowStore()
  const nodesInitialData = useNodesInitialData()
  const appDetail = useAppStore(state => state.appDetail)!
  const { data, error, mutate } = useSWR(`/apps/${appDetail.id}/workflows/draft`, fetchWorkflowDraft)

  const handleFetchPreloadData = async () => {
    try {
      const toolsets = await fetchCollectionList()
      const nodesDefaultConfigsData = await fetchNodesDefaultConfigs(`/apps/${appDetail?.id}/workflows/default-workflow-block-configs`)

      workflowStore.setState({
        toolsets,
        toolsMap: toolsets.reduce((acc, toolset) => {
          acc[toolset.id] = []
          return acc
        }, {} as ToolsMap),
      })
      workflowStore.setState({
        nodesDefaultConfigs: nodesDefaultConfigsData.reduce((acc, block) => {
          if (!acc[block.type])
            acc[block.type] = { ...block.config }
          return acc
        }, {} as Record<string, any>),
      })
    }
    catch (e) {

    }
  }

  useEffect(() => {
    handleFetchPreloadData()
  }, [])

  useEffect(() => {
    if (data)
      workflowStore.setState({ draftUpdatedAt: data.updated_at })
  }, [data, workflowStore])

  if (error && error.json && !error.bodyUsed && appDetail) {
    error.json().then((err: any) => {
      if (err.code === 'draft_workflow_not_exist') {
        workflowStore.setState({ notInitialWorkflow: true })
        syncWorkflowDraft({
          url: `/apps/${appDetail.id}/workflows/draft`,
          params: {
            graph: {
              nodes: [generateNewNode({
                data: {
                  ...nodesInitialData.start,
                  selected: true,
                },
                position: START_INITIAL_POSITION,
              })],
              edges: [],
            },
            features: {},
          },
        }).then((res) => {
          workflowStore.setState({ draftUpdatedAt: res.updated_at })
          mutate()
        })
      }
    })
  }

  return data
}
