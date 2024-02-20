'use client'

import { createContext, useContext } from 'use-context-selector'
import type { ModelAndParameter } from '../types'

export type DebugWithMultipleModelContextType = {
  multipleModelConfigs: ModelAndParameter[]
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
  onDebugWithMultipleModelChange: (singleModelConfig: ModelAndParameter) => void
  checkCanSend?: () => boolean
}
const DebugWithMultipleModelContext = createContext<DebugWithMultipleModelContextType>({
  multipleModelConfigs: [],
  onMultipleModelConfigsChange: () => {},
  onDebugWithMultipleModelChange: () => {},
})

export const useDebugWithMultipleModelContext = () => useContext(DebugWithMultipleModelContext)

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
