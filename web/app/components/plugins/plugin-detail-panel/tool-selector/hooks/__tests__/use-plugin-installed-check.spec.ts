import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '@/app/components/plugins/types'
import { usePluginInstalledCheck } from '../use-plugin-installed-check'

const mockUseCheckInstalled = vi.fn()
const mockUsePluginManifestInfo = vi.fn()

const mockManifest = {
  data: {
    plugin: {
      name: 'test-plugin',
      version: '1.0.0',
    },
  },
}

vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: (...args: unknown[]) => mockUseCheckInstalled(...args),
  usePluginManifestInfo: (...args: unknown[]) => mockUsePluginManifestInfo(...args),
}))

describe('usePluginInstalledCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCheckInstalled.mockImplementation(({ pluginIds, enabled }: { pluginIds: string[], enabled: boolean }) => ({
      data: enabled && pluginIds.length > 0
        ? { plugins: [] }
        : undefined,
    }))
    mockUsePluginManifestInfo.mockImplementation((pluginID: string) => ({
      data: pluginID ? mockManifest : undefined,
    }))
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

  it('should skip marketplace lookup when installed plugin source is local', () => {
    mockUseCheckInstalled.mockReturnValue({
      data: {
        plugins: [{
          source: PluginSource.local,
        }],
      },
    })

    const { result } = renderHook(() => usePluginInstalledCheck({
      providerName: 'org/plugin/tool',
      providerPluginId: 'org/plugin',
      enabled: true,
    }))

    expect(mockUsePluginManifestInfo).toHaveBeenCalledWith('')
    expect(result.current.inMarketPlace).toBe(false)
  })

  it('should skip all plugin checks for non-plugin providers', () => {
    const { result } = renderHook(() => usePluginInstalledCheck({
      providerName: 'time',
      providerPluginId: null,
      enabled: true,
    }))

    expect(mockUseCheckInstalled).toHaveBeenCalledWith({
      pluginIds: [],
      enabled: false,
    })
    expect(mockUsePluginManifestInfo).toHaveBeenCalledWith('')
    expect(result.current.pluginID).toBe('')
  })
})
