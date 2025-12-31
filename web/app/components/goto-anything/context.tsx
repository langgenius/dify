'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
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
  const [isWorkflowPage, setIsWorkflowPage] = useState(false)
  const [isRagPipelinePage, setIsRagPipelinePage] = useState(false)
  const pathname = usePathname()

  // Update context based on current pathname using more robust route matching
  useEffect(() => {
    if (!pathname) {
      setIsWorkflowPage(false)
      setIsRagPipelinePage(false)
      return
    }

    // Workflow pages: /app/[appId]/workflow or /workflow/[token] (shared)
    const isWorkflow = isInWorkflowPage()
    // RAG Pipeline pages: /datasets/[datasetId]/pipeline
    const isRagPipeline = /^\/datasets\/[^/]+\/pipeline$/.test(pathname)

    setIsWorkflowPage(isWorkflow)
    setIsRagPipelinePage(isRagPipeline)
  }, [pathname])

  return (
    <GotoAnythingContext.Provider value={{ isWorkflowPage, isRagPipelinePage }}>
      {children}
    </GotoAnythingContext.Provider>
  )
}
