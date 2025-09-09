'use client'

import type { ReactNode } from 'react'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Interface for the GotoAnything context
 */
type GotoAnythingContextType = {
  /**
   * Whether the current page is a workflow page
   */
  isWorkflowPage: boolean
}

// Create context with default values
const GotoAnythingContext = createContext<GotoAnythingContextType>({
  isWorkflowPage: false,
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
  const pathname = usePathname()

  // Update context based on current pathname
  useEffect(() => {
    // Check if current path contains workflow
    const isWorkflow = pathname?.includes('/workflow') || false
    setIsWorkflowPage(isWorkflow)
  }, [pathname])

  return (
    <GotoAnythingContext.Provider value={{ isWorkflowPage }}>
      {children}
    </GotoAnythingContext.Provider>
  )
}
