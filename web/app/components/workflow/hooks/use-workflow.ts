import { useCallback } from 'react'
import produce from 'immer'
import {
  getIncomers,
  getOutgoers,
  useStoreApi,
} from 'reactflow'
import { getLayoutByDagre } from '../utils'
import type { Node } from '../types'
import { BlockEnum } from '../types'
import { SUPPORT_OUTPUT_VARS_NODE } from '../constants'
import { useStore as useAppStore } from '@/app/components/app/store'

export const useIsChatMode = () => {
  const appDetail = useAppStore(s => s.appDetail)

  return appDetail?.mode === 'advanced-chat'
}

export const useWorkflow = () => {
  const store = useStoreApi()

  const handleLayout = useCallback(async () => {
    const {
      getNodes,
      edges,
      setNodes,
    } = store.getState()

    const layout = getLayoutByDagre(getNodes(), edges)

    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        const nodeWithPosition = layout.node(node.id)
        node.position = {
          x: nodeWithPosition.x,
          y: nodeWithPosition.y,
        }
      })
    })
    setNodes(newNodes)
  }, [store])

  const getTreeLeafNodes = useCallback(() => {
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
      const outgoers = getOutgoers(root, nodes, edges)

      if (outgoers.length) {
        outgoers.forEach((outgoer) => {
          preOrder(outgoer, callback)
        })
      }
      else {
        callback(root)
      }
    }
    preOrder(startNode, (node) => {
      list.push(node)
    })

    return list.filter((item) => {
      if (item.data.type === BlockEnum.IfElse)
        return false

      if (item.data.type === BlockEnum.QuestionClassifier)
        return false

      return true
    })
  }, [store])

  const getBeforeNodesInSameBranch = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)!
    const list: Node[] = []

    const traverse = (root: Node, callback: (node: Node) => void) => {
      const incomers = getIncomers(root, nodes, edges)

      if (incomers.length) {
        incomers.forEach((node) => {
          callback(node)
          traverse(node, callback)
        })
      }
    }
    traverse(currentNode, (node) => {
      list.push(node)
    })

    const length = list.length
    if (length && list.some(item => item.data.type === BlockEnum.Start)) {
      return list.reverse().filter((item) => {
        return SUPPORT_OUTPUT_VARS_NODE.includes(item.data.type)
      })
    }

    return []
  }, [store])

  return {
    handleLayout,
    getTreeLeafNodes,
    getBeforeNodesInSameBranch,
  }
}
