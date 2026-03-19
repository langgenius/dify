'use client'

import type { ReactNode } from 'react'
import type { DebugWithMultipleModelContextType } from './context'
import { useMemo } from 'react'
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
  const contextValue = useMemo(() => ({
    onMultipleModelConfigsChange,
    multipleModelConfigs,
    onDebugWithMultipleModelChange,
    checkCanSend,
  }), [
    onMultipleModelConfigsChange,
    multipleModelConfigs,
    onDebugWithMultipleModelChange,
    checkCanSend,
  ])

  return (
    <DebugWithMultipleModelContext.Provider value={contextValue}>
      {children}
    </DebugWithMultipleModelContext.Provider>
  )
}
