'use client'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

export type MCPToolUnavailableReason = 'version' | 'sandbox' | 'both'

type MCPToolAvailabilityContextValue = {
  versionSupported?: boolean
}

const MCPToolAvailabilityContext = createContext<MCPToolAvailabilityContextValue | undefined>(undefined)

export type MCPToolAvailability = {
  allowed: boolean
  reason?: MCPToolUnavailableReason
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
  const versionSupported = context?.versionSupported
  const versionOk = versionSupported === true

  if (versionOk)
    return { allowed: true, versionSupported }

  return {
    allowed: false,
    reason: 'version',
    versionSupported,
  }
}
