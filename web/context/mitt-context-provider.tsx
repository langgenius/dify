'use client'

import type { ReactNode } from 'react'
import { useMitt } from '@/hooks/use-mitt'
import { MittContext } from './mitt-context'

type MittProviderProps = {
  children: ReactNode
}

export const MittProvider = ({ children }: MittProviderProps) => {
  const mitt = useMitt()

  return (
    <MittContext.Provider value={mitt}>
      {children}
    </MittContext.Provider>
  )
}
