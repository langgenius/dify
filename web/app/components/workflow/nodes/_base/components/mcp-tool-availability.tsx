'use client'
import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'

type MCPToolAvailabilityContextValue = {
  versionSupported?: boolean
  sandboxEnabled?: boolean
}

const MCPToolAvailabilityContext = createContext<MCPToolAvailabilityContextValue | undefined>(undefined)

export type MCPToolAvailability = {
  allowed: boolean
  blockedBy?: 'version' | 'sandbox'
}

type ProviderProps = {
  versionSupported?: boolean
  sandboxEnabled?: boolean
  children: ReactNode
}

export function MCPToolAvailabilityProvider({
  versionSupported,
  sandboxEnabled,
  children,
}: ProviderProps): ReactNode {
  const parent = useContext(MCPToolAvailabilityContext)

  const value = useMemo<MCPToolAvailabilityContextValue>(() => ({
    versionSupported: versionSupported ?? parent?.versionSupported,
    sandboxEnabled: sandboxEnabled ?? parent?.sandboxEnabled,
  }), [versionSupported, sandboxEnabled, parent])

  return (
    <MCPToolAvailabilityContext.Provider value={value}>
      {children}
    </MCPToolAvailabilityContext.Provider>
  )
}

export function useMCPToolAvailability(): MCPToolAvailability {
  const context = useContext(MCPToolAvailabilityContext)

  if (!context)
    return { allowed: true }

  const versionAllowed = context.versionSupported ?? true
  const sandboxAllowed = context.sandboxEnabled ?? true
  const allowed = versionAllowed && sandboxAllowed

  let blockedBy: MCPToolAvailability['blockedBy']
  if (!versionAllowed)
    blockedBy = 'version'
  else if (!sandboxAllowed)
    blockedBy = 'sandbox'

  return { allowed, blockedBy }
}
