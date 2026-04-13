'use client'

import type { ReactNode } from 'react'
import type { DebugWithMultipleModelContextType } from './context'
import { DebugWithMultipleModelContext } from './context'

type DebugWithMultipleModelContextProviderProps = {
  children: ReactNode
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
