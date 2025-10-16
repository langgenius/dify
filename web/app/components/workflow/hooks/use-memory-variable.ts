import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import type { MemoryVariable, Node } from '@/app/components/workflow/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'

export const useMemoryVariable = () => {
  const workflowStore = useWorkflowStore()
  const setMemoryVariables = useStore(s => s.setMemoryVariables)
  const store = useStoreApi()

  const handleAddMemoryVariableToNode = useCallback((nodeId: string, memoryVariableId: string) => {
    const { getNodes, setNodes } = store.getState()
    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(n => n.id === nodeId)
      if (currentNode) {
        currentNode.data.memory = {
          ...(currentNode.data.memory || {}),
          block_id: [...(currentNode.data.memory?.block_id || []), memoryVariableId],
        }
      }
    })
    setNodes(newNodes)
  }, [store])

  const handleDeleteMemoryVariableFromNode = useCallback((nodeId: string, memoryVariableId: string) => {
    const { getNodes, setNodes } = store.getState()
    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(n => n.id === nodeId)
      if (currentNode) {
        currentNode.data.memory = {
          ...(currentNode.data.memory || {}),
          block_id: currentNode.data.memory?.block_id?.filter((id: string) => id !== memoryVariableId) || [],
        }
      }
    })
    setNodes(newNodes)
  }, [store])

  const handleAddMemoryVariable = useCallback((memoryVariable: MemoryVariable) => {
    const { memoryVariables } = workflowStore.getState()
    setMemoryVariables([memoryVariable, ...memoryVariables])

    if (memoryVariable.node)
      handleAddMemoryVariableToNode(memoryVariable.node, memoryVariable.id)
  }, [setMemoryVariables, workflowStore, handleAddMemoryVariableToNode])

  const handleUpdateMemoryVariable = useCallback((memoryVariable: MemoryVariable) => {
    const { memoryVariables } = workflowStore.getState()
    const oldMemoryVariable = memoryVariables.find(v => v.id === memoryVariable.id)
    setMemoryVariables(memoryVariables.map(v => v.id === memoryVariable.id ? memoryVariable : v))

    if (oldMemoryVariable && !oldMemoryVariable?.node && memoryVariable.node)
      handleAddMemoryVariableToNode(memoryVariable.node, memoryVariable.id)
    else if (oldMemoryVariable && oldMemoryVariable.node && !memoryVariable.node)
      handleDeleteMemoryVariableFromNode(oldMemoryVariable.node, memoryVariable.id)
  }, [setMemoryVariables, workflowStore, handleAddMemoryVariableToNode, handleDeleteMemoryVariableFromNode])

  const handleDeleteMemoryVariable = useCallback((memoryVariable: MemoryVariable) => {
    const { memoryVariables } = workflowStore.getState()
    setMemoryVariables(memoryVariables.filter(v => v.id !== memoryVariable.id))

    if (memoryVariable.node)
      handleDeleteMemoryVariableFromNode(memoryVariable.node, memoryVariable.id)
  }, [setMemoryVariables, workflowStore, handleDeleteMemoryVariableFromNode])

  return {
    handleAddMemoryVariable,
    handleUpdateMemoryVariable,
    handleDeleteMemoryVariable,
  }
}

export const useFormatMemoryVariables = () => {
  const formatMemoryVariables = useCallback((memoryVariables: MemoryVariable[], nodes: Node[]) => {
    let clonedMemoryVariables = [...memoryVariables]
    const nodeScopeMemoryVariablesIds = clonedMemoryVariables.filter(v => v.scope === 'node').map(v => v.id)
    const nodeScopeMemoryVariablesMap = nodeScopeMemoryVariablesIds.reduce((acc, id) => {
      acc[id] = id
      return acc
    }, {} as Record<string, string>)

    if (!!nodeScopeMemoryVariablesIds.length) {
      const llmNodes = nodes.filter(n => n.data.type === BlockEnum.LLM)

      clonedMemoryVariables = clonedMemoryVariables.map((v) => {
        if (nodeScopeMemoryVariablesMap[v.id]) {
          const node = llmNodes.find(n => ((n.data as LLMNodeType).memory?.block_id || []).includes(v.id))

          return {
            ...v,
            node: node?.id,
          }
        }

        return v
      })
    }

    return clonedMemoryVariables.map((v) => {
      return {
        ...v,
        value_type: ChatVarType.Memory,
      }
    })
  }, [])

  return {
    formatMemoryVariables,
  }
}
