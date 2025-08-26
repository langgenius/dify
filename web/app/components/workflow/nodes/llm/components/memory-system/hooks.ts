import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import type { LLMNodeType } from '../../types'
import { useNodeUpdate } from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

export const useMemory = (
  id: string,
  data: LLMNodeType,
) => {
  const { memory } = data
  const initCollapsed = useMemo(() => {
    if (!memory?.enabled)
      return true

    return false
  }, [memory])
  const [collapsed, setCollapsed] = useState(initCollapsed)
  const { getNodeData } = useNodeUpdate(id)

  const handleMemoryTypeChange = useCallback((value: string) => {
    const nodeData = getNodeData()
    console.log('nodeData', nodeData)

    if (value === 'disabled')
      console.log('disabled')
    if (value === 'linear')
      setCollapsed(true)
    if (value === 'block')
      setCollapsed(true)
  }, [getNodeData])

  return {
    collapsed,
    setCollapsed,
    handleMemoryTypeChange,
  }
}
