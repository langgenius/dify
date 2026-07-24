'use client'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

type MCPToolAvailabilityContextValue = {
  versionSupported?: boolean
}

const MCPToolAvailabilityContext = createContext<MCPToolAvailabilityContextValue | undefined>(undefined)

export type MCPToolAvailability = {
  allowed: boolean
  versionSupported?: boolean
}

export const MCPToolAvailabilityProvider = ({
  versionSupported,
  children,
}: {
  versionSupported?: boolean
  children: ReactNode
}) => (
  <MCPToolAvailabilityContext.Provider value={{ versionSupported }}>
    {children}
  </MCPToolAvailabilityContext.Provider>
)

export const useMCPToolAvailability = (): MCPToolAvailability => {
  const context = useContext(MCPToolAvailabilityContext)
  if (context === undefined)
    return { allowed: true }

  const { versionSupported } = context
  return {
    allowed: versionSupported === true,
    versionSupported,
  }
}
