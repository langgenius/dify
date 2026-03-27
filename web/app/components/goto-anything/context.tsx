'use client'

import type { ReactNode } from 'react'
import * as React from 'react'
import { createContext, useContext } from 'react'
import { usePathname } from '@/next/navigation'
import { isInWorkflowPage } from '../workflow/constants'

/**
 * Interface for the GotoAnything context
 */
type GotoAnythingContextType = {
  /**
   * Whether the current page is a workflow page
   */
  isWorkflowPage: boolean
  /**
   * Whether the current page is a RAG pipeline page
   */
  isRagPipelinePage: boolean
}

// Create context with default values
const GotoAnythingContext = createContext<GotoAnythingContextType>({
  isWorkflowPage: false,
  isRagPipelinePage: false,
})

/**
 * Hook to use the GotoAnything context
 */
export const useGotoAnythingContext = () => useContext(GotoAnythingContext)

type GotoAnythingProviderProps = {
  children: ReactNode
}

/**
 * Provider component for GotoAnything context
 */
export const GotoAnythingProvider: React.FC<GotoAnythingProviderProps> = ({ children }) => {
  const isWorkflowPage = /\/workflow(\/|$)/.test(pathname || '') || isInWorkflowPage()
  const isRagPipelinePage = /^\/datasets\/[^/]+\/pipeline$/.test(pathname || '')

  return (
    <GotoAnythingContext.Provider value={{ isWorkflowPage, isRagPipelinePage }}>
      {children}
    </GotoAnythingContext.Provider>
  )
}
