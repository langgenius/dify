import type { PluginDetail } from '../../../types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '../../../types'
import { useDetailHeaderState } from './use-detail-header-state'

let mockEnableMarketplace = true
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => unknown) =>
    selector({ systemFeatures: { enable_marketplace: mockEnableMarketplace } }),
}))

let mockAutoUpgradeInfo: {
  strategy_setting: string
  upgrade_mode: string
  include_plugins: string[]
  exclude_plugins: string[]
  upgrade_time_of_day: number
} | null = null

vi.mock('../../../plugin-page/use-reference-setting', () => ({
  default: () => ({
    referenceSetting: mockAutoUpgradeInfo ? { auto_upgrade: mockAutoUpgradeInfo } : null,
  }),
}))

vi.mock('../../../reference-setting-modal/auto-update-setting/types', () => ({
  AUTO_UPDATE_MODE: {
    update_all: 'update_all',
    partial: 'partial',
    exclude: 'exclude',
  },
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

  describe('Source Type Detection', () => {
    it('should detect marketplace source', () => {
      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isFromMarketplace).toBe(true)
      expect(result.current.isFromGitHub).toBe(false)
    })

    it('should detect GitHub source', () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isFromGitHub).toBe(true)
      expect(result.current.isFromMarketplace).toBe(false)
    })

    it('should detect local source', () => {
      const detail = createPluginDetail({ source: PluginSource.local })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.isFromGitHub).toBe(false)
      expect(result.current.isFromMarketplace).toBe(false)
    })
  })

  describe('Version State', () => {
    it('should detect new version available for marketplace plugin', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
        source: PluginSource.marketplace,
      })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.hasNewVersion).toBe(true)
    })

    it('should not detect new version when versions match', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '1.0.0',
        source: PluginSource.marketplace,
      })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.hasNewVersion).toBe(false)
    })

    it('should not detect new version for non-marketplace source', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.hasNewVersion).toBe(false)
    })

    it('should not detect new version when latest_version is empty', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '',
        source: PluginSource.marketplace,
      })
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.hasNewVersion).toBe(false)
    })
  })

  describe('Version Picker State', () => {
    it('should initialize version picker as hidden', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.versionPicker.isShow).toBe(false)
    })

    it('should toggle version picker visibility', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      act(() => {
        result.current.versionPicker.setIsShow(true)
      })
      expect(result.current.versionPicker.isShow).toBe(true)

      act(() => {
        result.current.versionPicker.setIsShow(false)
      })
      expect(result.current.versionPicker.isShow).toBe(false)
    })

    it('should update target version', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      act(() => {
        result.current.versionPicker.setTargetVersion({
          version: '2.0.0',
          unique_identifier: 'new-uid',
        })
      })

      expect(result.current.versionPicker.targetVersion.version).toBe('2.0.0')
      expect(result.current.versionPicker.targetVersion.unique_identifier).toBe('new-uid')
    })

    it('should set isDowngrade when provided in target version', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      act(() => {
        result.current.versionPicker.setTargetVersion({
          version: '0.5.0',
          unique_identifier: 'old-uid',
          isDowngrade: true,
        })
      })

      expect(result.current.versionPicker.isDowngrade).toBe(true)
    })
  })

  describe('Modal States', () => {
    it('should initialize all modals as hidden', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      expect(result.current.modalStates.isShowUpdateModal).toBe(false)
      expect(result.current.modalStates.isShowPluginInfo).toBe(false)
      expect(result.current.modalStates.isShowDeleteConfirm).toBe(false)
      expect(result.current.modalStates.deleting).toBe(false)
    })

    it('should toggle update modal', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      act(() => {
        result.current.modalStates.showUpdateModal()
      })
      expect(result.current.modalStates.isShowUpdateModal).toBe(true)

      act(() => {
        result.current.modalStates.hideUpdateModal()
      })
      expect(result.current.modalStates.isShowUpdateModal).toBe(false)
    })

    it('should toggle plugin info modal', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      act(() => {
        result.current.modalStates.showPluginInfo()
      })
      expect(result.current.modalStates.isShowPluginInfo).toBe(true)

      act(() => {
        result.current.modalStates.hidePluginInfo()
      })
      expect(result.current.modalStates.isShowPluginInfo).toBe(false)
    })

    it('should toggle delete confirm modal', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      act(() => {
        result.current.modalStates.showDeleteConfirm()
      })
      expect(result.current.modalStates.isShowDeleteConfirm).toBe(true)

      act(() => {
        result.current.modalStates.hideDeleteConfirm()
      })
      expect(result.current.modalStates.isShowDeleteConfirm).toBe(false)
    })

    it('should toggle deleting state', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() => useDetailHeaderState(detail))

      act(() => {
        result.current.modalStates.showDeleting()
      })
      expect(result.current.modalStates.deleting).toBe(true)

      act(() => {
        result.current.modalStates.hideDeleting()
      })
      expect(result.current.modalStates.deleting).toBe(false)
    })
  })

  describe('Auto Upgrade Detection', () => {
    it('should disable auto upgrade when marketplace is disabled', () => {
      mockEnableMarketplace = false
      mockAutoUpgradeInfo = {
        strategy_setting: 'enabled',
        upgrade_mode: 'update_all',
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
        upgrade_mode: 'update_all',
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
        strategy_setting: 'enabled',
        upgrade_mode: 'update_all',
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
        strategy_setting: 'enabled',
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
        strategy_setting: 'enabled',
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
        strategy_setting: 'enabled',
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
        strategy_setting: 'enabled',
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
        strategy_setting: 'enabled',
        upgrade_mode: 'update_all',
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
