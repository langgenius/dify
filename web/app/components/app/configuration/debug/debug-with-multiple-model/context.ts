'use client'

import type { ModelAndParameter } from '../types'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { noop } from 'es-toolkit/function'
import { createContext, useContext } from 'use-context-selector'

export type DebugWithMultipleModelContextType = {
  multipleModelConfigs: ModelAndParameter[]
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
  onDebugWithMultipleModelChange: (singleModelConfig: ModelAndParameter) => void
  onOpenLog: (item: IChatItem) => void
  checkCanSend?: () => boolean
}

export const DebugWithMultipleModelContext = createContext<DebugWithMultipleModelContextType>({
  multipleModelConfigs: [],
  onOpenLog: noop,
  onMultipleModelConfigsChange: noop,
  onDebugWithMultipleModelChange: noop,
})

export const useDebugWithMultipleModelContext = () => useContext(DebugWithMultipleModelContext)
