'use client'

import type { ModelAndParameter } from '../types'
import { noop } from 'es-toolkit/function'
import { createContext, useContext } from 'use-context-selector'

export type DebugWithMultipleModelContextType = {
  multipleModelConfigs: ModelAndParameter[]
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
  onDebugWithMultipleModelChange: (singleModelConfig: ModelAndParameter) => void
  checkCanSend?: () => boolean
}

export const DebugWithMultipleModelContext = createContext<DebugWithMultipleModelContextType>({
  multipleModelConfigs: [],
  onMultipleModelConfigsChange: noop,
  onDebugWithMultipleModelChange: noop,
})

export const useDebugWithMultipleModelContext = () => useContext(DebugWithMultipleModelContext)

export default DebugWithMultipleModelContext
