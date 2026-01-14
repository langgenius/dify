'use client'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

type MCPToolAvailabilityContextValue = {
  versionSupported?: boolean
  sandboxEnabled?: boolean
}

const MCPToolAvailabilityContext = createContext<MCPToolAvailabilityContextValue | undefined>(undefined)

export type MCPToolAvailability = {
  allowed: boolean
  versionSupported?: boolean
  sandboxEnabled?: boolean
  blockedBy?: 'version' | 'sandbox'
}

export const MCPToolAvailabilityProvider = ({
  versionSupported,
  sandboxEnabled,
  children,
}: {
  versionSupported?: boolean
  sandboxEnabled?: boolean
  children: ReactNode
}) => {
  const parentContext = useContext(MCPToolAvailabilityContext)
  const value = {
    versionSupported: versionSupported !== undefined
      ? versionSupported
      : parentContext?.versionSupported,
    sandboxEnabled: sandboxEnabled !== undefined
      ? sandboxEnabled
      : parentContext?.sandboxEnabled,
  }
  return (
    <MCPToolAvailabilityContext.Provider value={value}>
      {children}
    </MCPToolAvailabilityContext.Provider>
  )
}

export const useMCPToolAvailability = (): MCPToolAvailability => {
  const context = useContext(MCPToolAvailabilityContext)
  if (context === undefined)
    return { allowed: true }

  const { versionSupported, sandboxEnabled } = context
  const versionAllowed = versionSupported ?? true
  const sandboxAllowed = sandboxEnabled ?? true
  const allowed = versionAllowed && sandboxAllowed
  let blockedBy: MCPToolAvailability['blockedBy']
  if (!versionAllowed)
    blockedBy = 'version'
  else if (!sandboxAllowed)
    blockedBy = 'sandbox'
  return {
    allowed,
    versionSupported,
    sandboxEnabled,
    blockedBy,
  }
}
