'use client'

import type { ReactNode } from 'react'
import type { DebugWithMultipleModelContextType } from '../../../configuration/debug/debug-with-multiple-model/context'
import { DebugWithMultipleModelContext } from '../../../configuration/debug/debug-with-multiple-model/context'

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
