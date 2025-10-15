import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'

export const useMemoryVariables = (blockIds: string[]) => {
  const memoryVariables = useStore(s => s.memoryVariables)

  const memoryVariablesInUsed = useMemo(() => {
    return memoryVariables.filter(variable => blockIds.includes(variable.id))
  }, [memoryVariables, blockIds])

  const handleDelete = (blockId: string) => {
    console.log('delete', blockId)
  }
  return {
    memoryVariablesInUsed,
    handleDelete,
  }
}
