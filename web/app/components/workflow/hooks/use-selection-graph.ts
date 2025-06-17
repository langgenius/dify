import {
  useCallback,
} from 'react'
import type {
  OnSelectionChangeParams,
} from 'reactflow'
import { useOnSelectionChange } from 'reactflow'
import { useWorkflowStore } from '../store'

export const useSelectionGraph = () => {
  const workflowStore = useWorkflowStore()
  const { setSelectGraph } = workflowStore.getState()

  const onChange = useCallback((params: OnSelectionChangeParams) => {
    const { nodes, edges } = params
    setSelectGraph({
      nodes,
      edges,
    })
  }, [])

  useOnSelectionChange({
    onChange,
  })
}
