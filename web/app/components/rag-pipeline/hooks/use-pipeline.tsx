import { useCallback } from 'react'
import { getOutgoers, useStoreApi } from 'reactflow'
import { BlockEnum, type Node, type ValueSelector } from '../../workflow/types'
import { uniqBy } from 'lodash-es'
import { findUsedVarNodes, updateNodeVars } from '../../workflow/nodes/_base/components/variable/utils'
import type { DataSourceNodeType } from '../../workflow/nodes/data-source/types'

export const usePipeline = () => {
  const store = useStoreApi()

  const getAllDatasourceNodes = useCallback(() => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes() as Node<DataSourceNodeType>[]
    const datasourceNodes = nodes.filter(node => node.data.type === BlockEnum.DataSource)

    return datasourceNodes
  }, [store])

  const getAllNodesInSameBranch = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const list: Node[] = []

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

    if (nodeId === 'shared') {
      const allDatasourceNodes = getAllDatasourceNodes()

      if (allDatasourceNodes.length === 0)
        return []

      list.push(...allDatasourceNodes)

      allDatasourceNodes.forEach((node) => {
        traverse(node, (childNode) => {
          list.push(childNode)
        })
      })
    }
    else {
      const currentNode = nodes.find(node => node.id === nodeId)!

      if (!currentNode)
        return []

      list.push(currentNode)

      traverse(currentNode, (node) => {
        list.push(node)
      })
    }

    return uniqBy(list, 'id')
  }, [getAllDatasourceNodes, store])

  const isVarUsedInNodes = useCallback((varSelector: ValueSelector) => {
    const nodeId = varSelector[1] // Assuming the first element is always 'VARIABLE_PREFIX'(rag)
    const afterNodes = getAllNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(varSelector, afterNodes)
    return effectNodes.length > 0
  }, [getAllNodesInSameBranch])

  const handleInputVarRename = useCallback((nodeId: string, oldValeSelector: ValueSelector, newVarSelector: ValueSelector) => {
    const { getNodes, setNodes } = store.getState()
    const afterNodes = getAllNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(oldValeSelector, afterNodes)
    if (effectNodes.length > 0) {
      const newNodes = getNodes().map((node) => {
        if (effectNodes.find(n => n.id === node.id))
          return updateNodeVars(node, oldValeSelector, newVarSelector)

        return node
      })
      setNodes(newNodes)
    }
  }, [getAllNodesInSameBranch, store])

  const removeUsedVarInNodes = useCallback((varSelector: ValueSelector) => {
    const nodeId = varSelector[1] // Assuming the first element is always 'VARIABLE_PREFIX'(rag)
    const { getNodes, setNodes } = store.getState()
    const afterNodes = getAllNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(varSelector, afterNodes)
    if (effectNodes.length > 0) {
      const newNodes = getNodes().map((node) => {
        if (effectNodes.find(n => n.id === node.id))
          return updateNodeVars(node, varSelector, [])

        return node
      })
      setNodes(newNodes)
    }
  }, [getAllNodesInSameBranch, store])

  return {
    handleInputVarRename,
    isVarUsedInNodes,
    removeUsedVarInNodes,
  }
}
