import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'

export const useMemoryVariables = (nodeId: string) => {
  const memoryVariables = useStore(s => s.memoryVariables)

  const memoryVariablesInUsed = useMemo(() => {
    return memoryVariables.filter(variable => variable.node_id === nodeId)
  }, [memoryVariables, nodeId])

  const handleDelete = (blockId: string) => {
    console.log('delete', blockId)
  }
  return {
    memoryVariablesInUsed,
    handleDelete,
  }
}
