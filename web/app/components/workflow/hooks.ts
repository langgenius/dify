import {
  useCallback,
  useState,
} from 'react'

export const useWorkflow = () => {
  const [selectedNodeId, setSelectedNodeId] = useState('')

  const handleSelectedNodeId = useCallback((nodeId: string) => setSelectedNodeId(nodeId), [])

  return {
    selectedNodeId,
    handleSelectedNodeId,
  }
}
