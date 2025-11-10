import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import type { MemoryVariable } from '@/app/components/workflow/types'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useMemoryUsedDetector } from './use-memory-used-detector'

export const useMemoryVariables = (nodeId: string) => {
  const workflowStore = useWorkflowStore()
  const memoryVariables = useStore(s => s.memoryVariables)
  const [editMemoryVariable, setEditMemoryVariable] = useState<MemoryVariable | undefined>(undefined)
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getMemoryUsedDetector } = useMemoryUsedDetector(nodeId)
  const [cacheForDeleteMemoryVariable, setCacheForDeleteMemoryVariable] = useState<MemoryVariable | undefined>(undefined)

  const memoryVariablesInUsed = useMemo(() => {
    return memoryVariables.filter(variable => variable.node_id === nodeId)
  }, [memoryVariables, nodeId])

  const handleSave = useCallback((newMemoryVar: MemoryVariable) => {
    const { memoryVariables, setMemoryVariables } = workflowStore.getState()
    const newList = [newMemoryVar, ...memoryVariables]
    setMemoryVariables(newList)
    handleSyncWorkflowDraft()
  }, [handleSyncWorkflowDraft, workflowStore])

  const handleSetEditMemoryVariable = (memoryVariableId?: string) => {
    if (!memoryVariableId) {
      setEditMemoryVariable(undefined)
      return
    }
    const memoryVariable = memoryVariables.find(variable => variable.id === memoryVariableId)
    setEditMemoryVariable(memoryVariable)
  }

  const handleEdit = (memoryVariable: MemoryVariable) => {
    const { memoryVariables, setMemoryVariables } = workflowStore.getState()
    const newList = memoryVariables.map(variable => variable.id === memoryVariable.id ? memoryVariable : variable)
    setMemoryVariables(newList)
    handleSyncWorkflowDraft()
  }

  const handleDeleteConfirm = (memoryVariableId?: string) => {
    const { memoryVariables, setMemoryVariables } = workflowStore.getState()
    const newList = memoryVariables.filter(variable => variable.id !== memoryVariableId)
    setMemoryVariables(newList)
    handleSyncWorkflowDraft()
    setCacheForDeleteMemoryVariable(undefined)
  }

  const handleDelete = (memoryVariable: MemoryVariable) => {
    const effectedNodes = getMemoryUsedDetector(memoryVariable)
    if (effectedNodes.length > 0) {
      setCacheForDeleteMemoryVariable(memoryVariable)
      return
    }
    handleDeleteConfirm(memoryVariable.id)
  }

  return {
    memoryVariablesInUsed,
    handleDelete,
    handleSave,
    handleSetEditMemoryVariable,
    handleEdit,
    editMemoryVariable,
    handleDeleteConfirm,
    cacheForDeleteMemoryVariable,
    setCacheForDeleteMemoryVariable,
  }
}
