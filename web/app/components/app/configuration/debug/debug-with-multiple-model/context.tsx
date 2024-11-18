'use client'

import type { ModelAndParameter } from '../types'
import { createSelectorCtx } from '@/utils/context'

export type DebugWithMultipleModelContextType = {
  multipleModelConfigs: ModelAndParameter[]
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
  onDebugWithMultipleModelChange: (singleModelConfig: ModelAndParameter) => void
  checkCanSend?: () => boolean
}
const [,useDebugWithMultipleModelContext, DebugWithMultipleModelContext] = createSelectorCtx<DebugWithMultipleModelContextType>()

export { useDebugWithMultipleModelContext }

type DebugWithMultipleModelContextProviderProps = {
  children: React.ReactNode
} & DebugWithMultipleModelContextType
export const DebugWithMultipleModelContextProvider = ({
  children,
  onMultipleModelConfigsChange,
  multipleModelConfigs,
  onDebugWithMultipleModelChange,
  checkCanSend,
}: DebugWithMultipleModelContextProviderProps) => {
  return (
    <DebugWithMultipleModelContext.Provider value={{
      onMultipleModelConfigsChange,
      multipleModelConfigs,
      onDebugWithMultipleModelChange,
      checkCanSend,
    }}>
      {children}
    </DebugWithMultipleModelContext.Provider>
  )
}

export default DebugWithMultipleModelContext
