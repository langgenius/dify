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
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useMemoryUsedDetector } from './use-memory-used-detector'

export const useMemory = (
  id: string,
  data: LLMNodeType,
) => {
  const workflowStore = useWorkflowStore()
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
  const [showTipsWhenMemoryModeBlockToLinear, setShowTipsWhenMemoryModeBlockToLinear] = useState(false)
  const { getMemoryUsedDetector } = useMemoryUsedDetector(id)

  const handleMemoryTypeChange = useCallback((value: string) => {
    const nodeData = getNodeData()
    const { memory: memoryData = {} as Memory } = nodeData?.data as LLMNodeType

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
    setShowTipsWhenMemoryModeBlockToLinear(false)
  }, [getNodeData, handleNodeDataUpdate])

  const handleMemoryTypeChangeBefore = useCallback((value: string) => {
    const nodeData = getNodeData()
    const { memory: memoryData = {} as Memory } = nodeData?.data as LLMNodeType
    const { memoryVariables } = workflowStore.getState()

    if (memoryData.mode === MemoryMode.block && value === MemoryMode.linear && nodeData) {
      const globalMemoryVariables = memoryVariables.filter(variable => variable.scope === 'app')
      const currentNodeMemoryVariables = memoryVariables.filter(variable => variable.node_id === id)
      const allMemoryVariables = [...globalMemoryVariables, ...currentNodeMemoryVariables]

      for (const variable of allMemoryVariables) {
        const effectedNodes = getMemoryUsedDetector(variable)

        if (effectedNodes.length > 0) {
          setShowTipsWhenMemoryModeBlockToLinear(true)
          return
        }
      }
      handleMemoryTypeChange(value)
    }
    else {
      handleMemoryTypeChange(value)
    }
  }, [getNodeData, workflowStore, handleMemoryTypeChange])

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
    handleMemoryTypeChangeBefore,
    memoryType,
    handleUpdateMemory,
    showTipsWhenMemoryModeBlockToLinear,
    setShowTipsWhenMemoryModeBlockToLinear,
  }
}
