import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useCheckInstalled from '../use-check-installed'

const mockPlugins = [
  {
    plugin_id: 'plugin-1',
    id: 'installed-1',
    declaration: { version: '1.0.0' },
    plugin_unique_identifier: 'org/plugin-1',
  },
  {
    plugin_id: 'plugin-2',
    id: 'installed-2',
    declaration: { version: '2.0.0' },
    plugin_unique_identifier: 'org/plugin-2',
  },
]

vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: ({ pluginIds, enabled }: { pluginIds: string[], enabled: boolean }) => ({
    data: enabled && pluginIds.length > 0 ? { plugins: mockPlugins } : undefined,
    isLoading: false,
    error: null,
  }),
}))

describe('useCheckInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return installed info when enabled and has plugin IDs', () => {
    const { result } = renderHook(() => useCheckInstalled({
      pluginIds: ['plugin-1', 'plugin-2'],
      enabled: true,
    }))

    expect(result.current.installedInfo).toBeDefined()
    expect(result.current.installedInfo?.['plugin-1']).toEqual({
      installedId: 'installed-1',
      installedVersion: '1.0.0',
      uniqueIdentifier: 'org/plugin-1',
    })
    expect(result.current.installedInfo?.['plugin-2']).toEqual({
      installedId: 'installed-2',
      installedVersion: '2.0.0',
      uniqueIdentifier: 'org/plugin-2',
    })
  })

  it('should return undefined installedInfo when disabled', () => {
    const { result } = renderHook(() => useCheckInstalled({
      pluginIds: ['plugin-1'],
      enabled: false,
    }))

    expect(result.current.installedInfo).toBeUndefined()
  })

  it('should return undefined installedInfo with empty plugin IDs', () => {
    const { result } = renderHook(() => useCheckInstalled({
      pluginIds: [],
      enabled: true,
    }))

    expect(result.current.installedInfo).toBeUndefined()
  })

  it('should return isLoading and error states', () => {
    const { result } = renderHook(() => useCheckInstalled({
      pluginIds: ['plugin-1'],
      enabled: true,
    }))

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
