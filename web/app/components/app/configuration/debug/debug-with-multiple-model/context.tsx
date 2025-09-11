'use client'

import { createContext, use } from 'react'
import type { ModelAndParameter } from '../types'
import { noop } from 'lodash-es'

export type DebugWithMultipleModelContextType = {
  multipleModelConfigs: ModelAndParameter[]
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
  onDebugWithMultipleModelChange: (singleModelConfig: ModelAndParameter) => void
  checkCanSend?: () => boolean
}
const DebugWithMultipleModelContext = createContext<DebugWithMultipleModelContextType>({
  multipleModelConfigs: [],
  onMultipleModelConfigsChange: noop,
  onDebugWithMultipleModelChange: noop,
})

export const useDebugWithMultipleModelContext = () => use(DebugWithMultipleModelContext)

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
