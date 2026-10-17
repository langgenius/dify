import type { PluginDetail } from '../../../../types'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { PluginSource } from '../../../../types'
import { useDetailHeaderState } from '../use-detail-header-state'

let mockEnableMarketplace = true

const renderHook = <Result>(callback: () => Result) =>
  renderHookWithConsoleQuery(callback, {
    systemFeatures: { enable_marketplace: mockEnableMarketplace },
  })

let mockAutoUpgradeInfo: {
  strategy_setting: string
  upgrade_mode: string
  include_plugins: string[]
  exclude_plugins: string[]
  upgrade_time_of_day: number
} | null = null

vi.mock('../../../../plugin-page/use-reference-setting', () => ({
  default: () => ({
    referenceSetting: mockAutoUpgradeInfo ? { auto_upgrade: mockAutoUpgradeInfo } : null,
  }),
}))

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {
    author: 'test-author',
    name: 'test-plugin-name',
    category: 'tool',
    label: { en_US: 'Test Plugin Label' },
    description: { en_US: 'Test description' },
    icon: 'icon.png',
    verified: true,
  } as unknown as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-uid',
  source: PluginSource.marketplace,
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

describe('useDetailHeaderState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAutoUpgradeInfo = null
    mockEnableMarketplace = true
  })

  it.each([
    [PluginSource.marketplace, '2.0.0', true],
    [PluginSource.marketplace, '1.0.0', false],
    [PluginSource.marketplace, '', false],
    [PluginSource.github, '2.0.0', false],
    [PluginSource.local, '2.0.0', false],
  ] as const)(
    'offers a newer version only for marketplace sources (%s, %s)',
    (source, latest_version, expected) => {
      const { result } = renderHook(() =>
        useDetailHeaderState(createPluginDetail({ source, latest_version })),
      )
      expect(result.current.hasNewVersion).toBe(expected)
      expect(result.current.isFromGitHub).toBe(source === PluginSource.github)
      expect(result.current.isFromMarketplace).toBe(source === PluginSource.marketplace)
    },
  )

  it('updates the selected target and keeps downgrade state in sync', () => {
    const { result } = renderHook(() => useDetailHeaderState(createPluginDetail()))
    act(() =>
      result.current.versionPicker.setTargetVersion({
        version: '0.5.0',
        unique_identifier: 'old-uid',
        isDowngrade: true,
      }),
    )
    expect(result.current.versionPicker.targetVersion).toEqual({
      version: '0.5.0',
      unique_identifier: 'old-uid',
      isDowngrade: true,
    })
    expect(result.current.versionPicker.isDowngrade).toBe(true)
    act(() =>
      result.current.versionPicker.setTargetVersion({
        version: '2.0.0',
        unique_identifier: 'new-uid',
        isDowngrade: false,
      }),
    )
    expect(result.current.versionPicker.isDowngrade).toBe(false)
  })

  describe('Auto Upgrade Detection', () => {
    it('should disable auto upgrade when marketplace is disabled', () => {
      mockEnableMarketplace = false
      mockAutoUpgradeInfo = {
        strategy_setting: 'latest',
        upgrade_mode: 'all',
        include_plugins: [],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(false)
    })

    it('should disable auto upgrade when strategy is disabled', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'disabled',
        upgrade_mode: 'all',
        include_plugins: [],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(false)
    })

    it('should enable auto upgrade for update_all mode', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'latest',
        upgrade_mode: 'all',
        include_plugins: [],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(true)
    })

    it('should enable auto upgrade for partial mode when plugin is included', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'latest',
        upgrade_mode: 'partial',
        include_plugins: ['test-plugin'],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(true)
    })

    it('should disable auto upgrade for partial mode when plugin is not included', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'latest',
        upgrade_mode: 'partial',
        include_plugins: ['other-plugin'],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(false)
    })

    it('should enable auto upgrade for exclude mode when plugin is not excluded', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'latest',
        upgrade_mode: 'exclude',
        include_plugins: [],
        exclude_plugins: ['other-plugin'],
        upgrade_time_of_day: 36000,
      }

      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(true)
    })

    it('should disable auto upgrade for exclude mode when plugin is excluded', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'latest',
        upgrade_mode: 'exclude',
        include_plugins: [],
        exclude_plugins: ['test-plugin'],
        upgrade_time_of_day: 36000,
      }

      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(false)
    })

    it('should disable auto upgrade for non-marketplace source', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'latest',
        upgrade_mode: 'all',
        include_plugins: [],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(false)
    })

    it('should disable auto upgrade when no auto upgrade info', () => {
      mockAutoUpgradeInfo = null

      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isAutoUpgradeEnabled).toBe(false)
    })
  })
})
