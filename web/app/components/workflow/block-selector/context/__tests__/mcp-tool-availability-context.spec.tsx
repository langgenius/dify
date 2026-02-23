import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MCPToolAvailabilityProvider, useMCPToolAvailability } from '../mcp-tool-availability-context'

describe('useMCPToolAvailability', () => {
  it('returns allowed=true without provider', () => {
    const { result } = renderHook(() => useMCPToolAvailability())

    expect(result.current).toEqual({ allowed: true })
  })

  it('returns allowed=false when version is not provided to provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MCPToolAvailabilityProvider>
        {children}
      </MCPToolAvailabilityProvider>
    )

    const { result } = renderHook(() => useMCPToolAvailability(), { wrapper })

    expect(result.current).toEqual({ allowed: false })
  })

  it('returns allowed=false when version is not supported', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MCPToolAvailabilityProvider versionSupported={false}>
        {children}
      </MCPToolAvailabilityProvider>
    )

    const { result } = renderHook(() => useMCPToolAvailability(), { wrapper })

    expect(result.current).toEqual({ allowed: false })
  })

  it('returns allowed=true when version is supported', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MCPToolAvailabilityProvider versionSupported={true}>
        {children}
      </MCPToolAvailabilityProvider>
    )

    const { result } = renderHook(() => useMCPToolAvailability(), { wrapper })

    expect(result.current).toEqual({ allowed: true })
  })
})
