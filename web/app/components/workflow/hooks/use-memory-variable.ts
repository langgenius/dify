import {
  useCallback,
} from 'react'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import type { MemoryVariable } from '@/app/components/workflow/types'

export const useMemoryVariable = () => {
  const workflowStore = useWorkflowStore()
  const setMemoryVariables = useStore(s => s.setMemoryVariables)

  const handleAddMemoryVariable = useCallback((memoryVariable: MemoryVariable) => {
    const { memoryVariables } = workflowStore.getState()
    setMemoryVariables([memoryVariable, ...memoryVariables])
  }, [setMemoryVariables, workflowStore])

  const handleUpdateMemoryVariable = useCallback((memoryVariable: MemoryVariable) => {
    const { memoryVariables } = workflowStore.getState()
    setMemoryVariables(memoryVariables.map(v => v.id === memoryVariable.id ? memoryVariable : v))
  }, [setMemoryVariables, workflowStore])

  const handleDeleteMemoryVariable = useCallback((memoryVariable: MemoryVariable) => {
    const { memoryVariables } = workflowStore.getState()
    setMemoryVariables(memoryVariables.filter(v => v.id !== memoryVariable.id))
  }, [setMemoryVariables, workflowStore])

  return {
    handleAddMemoryVariable,
    handleUpdateMemoryVariable,
    handleDeleteMemoryVariable,
  }
}

export const useFormatMemoryVariables = () => {
  const formatMemoryVariables = useCallback((memoryVariables: MemoryVariable[]) => {
    return memoryVariables.map((v) => {
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
