import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePluginInstalledCheck } from '../use-plugin-installed-check'

const mockManifest = {
  data: {
    plugin: {
      name: 'test-plugin',
      version: '1.0.0',
    },
  },
}

vi.mock('@/service/use-plugins', () => ({
  usePluginManifestInfo: (pluginID: string) => ({
    data: pluginID ? mockManifest : undefined,
  }),
}))

describe('usePluginInstalledCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should extract pluginID from provider name', () => {
    const { result } = renderHook(() => usePluginInstalledCheck('org/plugin/tool'))

    expect(result.current.pluginID).toBe('org/plugin')
  })

  it('should detect plugin in marketplace when manifest exists', () => {
    const { result } = renderHook(() => usePluginInstalledCheck('org/plugin/tool'))

    expect(result.current.inMarketPlace).toBe(true)
    expect(result.current.manifest).toEqual(mockManifest.data.plugin)
  })

  it('should handle empty provider name', () => {
    const { result } = renderHook(() => usePluginInstalledCheck(''))

    expect(result.current.pluginID).toBe('')
    expect(result.current.inMarketPlace).toBe(false)
  })

  it('should handle undefined provider name', () => {
    const { result } = renderHook(() => usePluginInstalledCheck())

    expect(result.current.pluginID).toBe('')
    expect(result.current.inMarketPlace).toBe(false)
  })

  it('should handle provider name with only one segment', () => {
    const { result } = renderHook(() => usePluginInstalledCheck('single'))

    expect(result.current.pluginID).toBe('single')
  })

  it('should handle provider name with two segments', () => {
    const { result } = renderHook(() => usePluginInstalledCheck('org/plugin'))

    expect(result.current.pluginID).toBe('org/plugin')
  })
})
