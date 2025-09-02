import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import type { LLMNodeType } from '../../types'
import { useNodeUpdate } from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  MEMORY_DEFAULT,
} from './linear-memory'
import type { Memory } from '@/app/components/workflow/types'

export const useMemory = (
  id: string,
  data: LLMNodeType,
) => {
  const { memory = {} as Memory } = data
  const initCollapsed = useMemo(() => {
    if (!memory?.enabled)
      return true

    return false
  }, [memory])
  const [collapsed, setCollapsed] = useState(initCollapsed)
  const {
    getNodeData,
    handleNodeDataUpdate,
  } = useNodeUpdate(id)

  const handleMemoryTypeChange = useCallback((value: string) => {
    const nodeData = getNodeData()
    const { memory: memoryData = {} } = nodeData as any

    if (value === 'disabled') {
      setCollapsed(true)
      handleNodeDataUpdate({
        memory: {
          ...memoryData,
          enabled: false,
          mode: '',
        },
      })
    }
    if (value === 'linear') {
      setCollapsed(false)
      handleNodeDataUpdate({
        memory: {
          ...memoryData,
          enabled: true,
          mode: 'linear',
          window: memoryData?.window || MEMORY_DEFAULT.window,
          query_prompt_template: memoryData?.query_prompt_template || MEMORY_DEFAULT.query_prompt_template,
        },
      })
    }
    if (value === 'block') {
      setCollapsed(false)
      handleNodeDataUpdate({
        memory: {
          ...memoryData,
          enabled: true,
          mode: 'block',
          block_id: memoryData?.block_id || [],
          query_prompt_template: memoryData?.query_prompt_template || MEMORY_DEFAULT.query_prompt_template,
        },
      })
    }
  }, [getNodeData, handleNodeDataUpdate])

  const handleUpdateMemory = useCallback((memory: Memory) => {
    handleNodeDataUpdate({
      memory,
    })
  }, [handleNodeDataUpdate])

  const memoryType = useMemo(() => {
    if (memory?.enabled) {
      if (memory.mode === 'linear')
        return 'linear'
      if (memory.mode === 'block')
        return 'block'
    }
    else {
      if (memory?.window?.enabled)
        return 'linear'

      return 'disabled'
    }
  }, [memory])

  return {
    collapsed,
    setCollapsed,
    handleMemoryTypeChange,
    memoryType,
    handleUpdateMemory,
  }
}
