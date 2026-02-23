import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MCPToolAvailabilityProvider, useMCPToolAvailability } from '../mcp-tool-availability-context'

describe('useMCPToolAvailability', () => {
  it('returns allowed=true without provider', () => {
    const { result } = renderHook(() => useMCPToolAvailability())

    expect(result.current).toEqual({ allowed: true })
  })

  it('returns allowed=true when version is not provided to provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MCPToolAvailabilityProvider>
        {children}
      </MCPToolAvailabilityProvider>
    )

    const { result } = renderHook(() => useMCPToolAvailability(), { wrapper })

    expect(result.current).toEqual({ allowed: true })
  })

  it('returns allowed=false when version is not supported', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MCPToolAvailabilityProvider versionSupported={false}>
        {children}
      </MCPToolAvailabilityProvider>
    )

    const { result } = renderHook(() => useMCPToolAvailability(), { wrapper })

    expect(result.current).toEqual({ allowed: false, blockedBy: 'version' })
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

  it('returns allowed=false when sandbox is not enabled', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MCPToolAvailabilityProvider sandboxEnabled={false}>
        {children}
      </MCPToolAvailabilityProvider>
    )

    const { result } = renderHook(() => useMCPToolAvailability(), { wrapper })

    expect(result.current).toEqual({ allowed: false, blockedBy: 'sandbox' })
  })

  it('inherits parent provider values when child omits them', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MCPToolAvailabilityProvider sandboxEnabled={false}>
        <MCPToolAvailabilityProvider versionSupported={true}>
          {children}
        </MCPToolAvailabilityProvider>
      </MCPToolAvailabilityProvider>
    )

    const { result } = renderHook(() => useMCPToolAvailability(), { wrapper })

    expect(result.current).toEqual({ allowed: false, blockedBy: 'sandbox' })
  })

  it('allows access when child provider overrides parent sandbox value', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MCPToolAvailabilityProvider sandboxEnabled={false}>
        <MCPToolAvailabilityProvider versionSupported={true} sandboxEnabled={true}>
          {children}
        </MCPToolAvailabilityProvider>
      </MCPToolAvailabilityProvider>
    )

    const { result } = renderHook(() => useMCPToolAvailability(), { wrapper })

    expect(result.current).toEqual({ allowed: true })
  })
})
