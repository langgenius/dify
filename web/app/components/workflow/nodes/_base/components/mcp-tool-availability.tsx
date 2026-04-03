'use client'
import type { ReactNode } from 'react'
import { createContext, use } from 'react'

type MCPToolAvailabilityContextValue = {
  versionSupported?: boolean
}

const MCPToolAvailabilityContext = createContext<MCPToolAvailabilityContextValue | undefined>(undefined)

type MCPToolAvailability = {
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
  const context = use(MCPToolAvailabilityContext)
  if (context === undefined)
    return { allowed: true }

  const { versionSupported } = context
  return {
    allowed: versionSupported === true,
    versionSupported,
  }
}
