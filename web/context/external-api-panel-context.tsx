'use client'

import * as React from 'react'
import { createContext, useContext, useState } from 'react'

type ExternalApiPanelContextType = {
  showExternalApiPanel: boolean
  setShowExternalApiPanel: (show: boolean) => void
}

const ExternalApiPanelContext = createContext<ExternalApiPanelContextType | undefined>(undefined)

export const ExternalApiPanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showExternalApiPanel, setShowExternalApiPanel] = useState(false)

  return (
    <ExternalApiPanelContext.Provider value={{ showExternalApiPanel, setShowExternalApiPanel }}>
      {children}
    </ExternalApiPanelContext.Provider>
  )
}

export const useExternalApiPanel = () => {
  const context = useContext(ExternalApiPanelContext)
  if (context === undefined)
    throw new Error('useExternalApiPanel must be used within an ExternalApiPanelProvider')

  return context
}
