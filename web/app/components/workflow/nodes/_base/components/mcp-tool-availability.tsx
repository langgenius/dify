'use client'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { useFeatures } from '@/app/components/base/features/hooks'

export type MCPToolUnavailableReason = 'version' | 'sandbox' | 'both'

type MCPToolAvailabilityContextValue = {
  versionSupported?: boolean
}

const MCPToolAvailabilityContext = createContext<MCPToolAvailabilityContextValue | undefined>(undefined)

export type MCPToolAvailability = {
  allowed: boolean
  reason?: MCPToolUnavailableReason
  sandboxEnabled: boolean
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
  const sandboxEnabled = useFeatures(state => state.features.sandbox?.enabled)
  const versionSupported = context?.versionSupported
  const versionOk = versionSupported !== false
  const sandboxOk = !!sandboxEnabled

  if (versionOk && sandboxOk) {
    return {
      allowed: true,
      sandboxEnabled: sandboxOk,
      versionSupported,
    }
  }

  let reason: MCPToolUnavailableReason
  if (!versionOk && !sandboxOk)
    reason = 'both'
  else if (!versionOk)
    reason = 'version'
  else
    reason = 'sandbox'

  return {
    allowed: false,
    reason,
    sandboxEnabled: sandboxOk,
    versionSupported,
  }
}
