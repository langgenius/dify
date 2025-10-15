import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import type { LLMNodeType } from '../../../types'
import { useNodeUpdate } from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  MEMORY_DEFAULT,
} from '../linear-memory'
import type { Memory } from '@/app/components/workflow/types'
import { MemoryMode } from '@/app/components/workflow/types'

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
  const {
    getNodeData,
    handleNodeDataUpdate,
  } = useNodeUpdate(id)

  const handleMemoryTypeChange = useCallback((value: string) => {
    const nodeData = getNodeData()
    const { memory: memoryData = {} } = nodeData as any

    if (value === MemoryMode.disabled) {
      setCollapsed(true)
      handleNodeDataUpdate({
        memory: {
          ...memoryData,
          enabled: false,
          mode: '',
        },
      })
    }
    if (value === MemoryMode.linear) {
      setCollapsed(false)
      handleNodeDataUpdate({
        memory: {
          ...memoryData,
          enabled: true,
          mode: MemoryMode.linear,
          window: memoryData?.window || MEMORY_DEFAULT.window,
          query_prompt_template: memoryData?.query_prompt_template || MEMORY_DEFAULT.query_prompt_template,
        },
      })
    }
    if (value === MemoryMode.block) {
      setCollapsed(false)
      handleNodeDataUpdate({
        memory: {
          ...memoryData,
          enabled: true,
          mode: MemoryMode.block,
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
    if (!memory)
      return MemoryMode.disabled

    if (!('enabled' in memory))
      return MemoryMode.linear

    if (memory.enabled) {
      if (memory.mode === MemoryMode.linear)
        return MemoryMode.linear
      if (memory.mode === MemoryMode.block)
        return MemoryMode.block
    }
    else {
      return MemoryMode.disabled
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
