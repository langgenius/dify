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
const DebugWithMultipleModelContext = createContext<DebugWithMultipleModelContextType>({
  multipleModelConfigs: [],
  onMultipleModelConfigsChange: noop,
  onDebugWithMultipleModelChange: noop,
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
    }}
    >
      {children}
    </DebugWithMultipleModelContext.Provider>
  )
}

export default DebugWithMultipleModelContext
