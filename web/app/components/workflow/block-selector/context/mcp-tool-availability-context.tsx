'use client'
import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'

type MCPToolAvailabilityContextValue = {
  versionSupported?: boolean
}

const MCPToolAvailabilityContext = createContext<MCPToolAvailabilityContextValue | undefined>(undefined)

export type MCPToolAvailability = {
  allowed: boolean
}

export const MCPToolAvailabilityProvider = ({
  versionSupported,
  children,
}: {
  versionSupported?: boolean
  children: ReactNode
}) => {
  const value = useMemo<MCPToolAvailabilityContextValue>(() => ({ versionSupported }), [versionSupported])

  return (
    <MCPToolAvailabilityContext.Provider value={value}>
      {children}
    </MCPToolAvailabilityContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMCPToolAvailability = (): MCPToolAvailability => {
  const context = useContext(MCPToolAvailabilityContext)
  if (context === undefined)
    return { allowed: true }

  const { versionSupported } = context
  return {
    allowed: versionSupported === true,
  }
}
