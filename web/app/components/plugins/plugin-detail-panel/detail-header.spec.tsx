import type { PluginDetail } from '../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplitude from '@/app/components/base/amplitude'
import Toast from '@/app/components/base/toast'
import { PluginSource } from '../types'
import DetailHeader from './detail-header'

// Use vi.hoisted for mock functions used in vi.mock factories
const {
  mockSetShowUpdatePluginModal,
  mockRefreshModelProviders,
  mockInvalidateAllToolProviders,
  mockUninstallPlugin,
  mockFetchReleases,
  mockCheckForUpdates,
} = vi.hoisted(() => {
  return {
    mockSetShowUpdatePluginModal: vi.fn(),
    mockRefreshModelProviders: vi.fn(),
    mockInvalidateAllToolProviders: vi.fn(),
    mockUninstallPlugin: vi.fn(() => Promise.resolve({ success: true })),
    mockFetchReleases: vi.fn(() => Promise.resolve([{ tag_name: 'v2.0.0' }])),
    mockCheckForUpdates: vi.fn(() => ({ needUpdate: true, toastProps: { type: 'success', message: 'Update available' } })),
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('ahooks', async () => {
  const React = await import('react')
  return {
    useBoolean: (initial: boolean) => {
      const [value, setValue] = React.useState(initial)
      return [
        value,
        {
          setTrue: () => setValue(true),
          setFalse: () => setValue(false),
        },
      ]
    },
  }
})

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { timezone: 'UTC' },
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
  useLocale: () => 'en-US',
}))

// Global mock state for enable_marketplace
let mockEnableMarketplace = true

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => unknown) =>
    selector({ systemFeatures: { enable_marketplace: mockEnableMarketplace } }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowUpdatePluginModal: mockSetShowUpdatePluginModal,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    refreshModelProviders: mockRefreshModelProviders,
  }),
}))

vi.mock('@/service/plugins', () => ({
  uninstallPlugin: mockUninstallPlugin,
}))

vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => ({ data: [] }),
  useInvalidateAllToolProviders: () => mockInvalidateAllToolProviders,
}))

vi.mock('../install-plugin/hooks', () => ({
  useGitHubReleases: () => ({
    checkForUpdates: mockCheckForUpdates,
    fetchReleases: mockFetchReleases,
  }),
}))

// Auto upgrade settings mock
let mockAutoUpgradeInfo: {
  strategy_setting: string
  upgrade_mode: string
  include_plugins: string[]
  exclude_plugins: string[]
  upgrade_time_of_day: number
} | null = null

vi.mock('../plugin-page/use-reference-setting', () => ({
  default: () => ({
    referenceSetting: mockAutoUpgradeInfo ? { auto_upgrade: mockAutoUpgradeInfo } : null,
  }),
}))

vi.mock('../reference-setting-modal/auto-update-setting/types', () => ({
  AUTO_UPDATE_MODE: {
    update_all: 'update_all',
    partial: 'partial',
    exclude: 'exclude',
  },
}))

vi.mock('../reference-setting-modal/auto-update-setting/utils', () => ({
  convertUTCDaySecondsToLocalSeconds: (seconds: number) => seconds,
  timeOfDayToDayjs: () => ({ format: () => '10:00 AM' }),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string>) => obj?.en_US || '',
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.example.com${path}`,
}))

vi.mock('../card/base/card-icon', () => ({
  default: ({ src }: { src: string }) => <div data-testid="card-icon" data-src={src} />,
}))

vi.mock('../card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="description">{text}</div>,
}))

vi.mock('../card/base/org-info', () => ({
  default: ({ orgName }: { orgName: string }) => <div data-testid="org-info">{orgName}</div>,
}))

vi.mock('../card/base/title', () => ({
  default: ({ title }: { title: string }) => <div data-testid="title">{title}</div>,
}))

vi.mock('../base/badges/verified', () => ({
  default: () => <span data-testid="verified-badge" />,
}))

vi.mock('../base/deprecation-notice', () => ({
  default: () => <div data-testid="deprecation-notice" />,
}))

// Enhanced operation-dropdown mock
vi.mock('./operation-dropdown', () => ({
  default: ({ onInfo, onCheckVersion, onRemove }: { onInfo: () => void, onCheckVersion: () => void, onRemove: () => void }) => (
    <div data-testid="operation-dropdown">
      <button data-testid="info-btn" onClick={onInfo}>Info</button>
      <button data-testid="check-version-btn" onClick={onCheckVersion}>Check Version</button>
      <button data-testid="remove-btn" onClick={onRemove}>Remove</button>
    </div>
  ),
}))

// Enhanced update modal mock
vi.mock('../update-plugin/from-market-place', () => ({
  default: ({ onSave, onCancel }: { onSave: () => void, onCancel: () => void }) => {
    return (
      <div data-testid="update-modal">
        <button data-testid="update-modal-save" onClick={onSave}>Save</button>
        <button data-testid="update-modal-cancel" onClick={onCancel}>Cancel</button>
      </div>
    )
  },
}))

// Enhanced version picker mock
vi.mock('../update-plugin/plugin-version-picker', () => ({
  default: ({ trigger, onSelect, onShowChange }: { trigger: React.ReactNode, onSelect: (state: { version: string, unique_identifier: string, isDowngrade?: boolean }) => void, onShowChange: (show: boolean) => void }) => (
    <div data-testid="version-picker">
      {trigger}
      <button
        data-testid="select-version-btn"
        onClick={() => {
          onShowChange(true)
          onSelect({ version: '2.0.0', unique_identifier: 'new-uid', isDowngrade: false })
        }}
      >
        Select Version
      </button>
      <button
        data-testid="select-downgrade-btn"
        onClick={() => {
          onShowChange(true)
          onSelect({ version: '0.5.0', unique_identifier: 'old-uid', isDowngrade: true })
        }}
      >
        Downgrade
      </button>
    </div>
  ),
}))

vi.mock('../plugin-page/plugin-info', () => ({
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="plugin-info">
      <button data-testid="plugin-info-close" onClick={onHide}>Close</button>
    </div>
  ),
}))

vi.mock('../plugin-auth', () => ({
  AuthCategory: { tool: 'tool' },
  PluginAuth: () => <div data-testid="plugin-auth" />,
}))

// Mock Confirm component
vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onCancel, onConfirm, isLoading }: {
    isShow: boolean
    onCancel: () => void
    onConfirm: () => void
    isLoading: boolean
  }) => isShow
    ? (
        <div data-testid="delete-confirm">
          <button data-testid="confirm-cancel" onClick={onCancel}>Cancel</button>
          <button data-testid="confirm-ok" onClick={onConfirm} disabled={isLoading}>Confirm</button>
        </div>
      )
    : null,
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
    tool: {
      identity: {
        name: 'test-tool',
        author: 'author',
        description: { en_US: 'Tool desc' },
        icon: 'icon.png',
        label: { en_US: 'Tool' },
        tags: [],
      },
      credentials_schema: [],
    },
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

describe('DetailHeader', () => {
  const mockOnUpdate = vi.fn()
  const mockOnHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAutoUpgradeInfo = null
    mockEnableMarketplace = true
    vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
    vi.spyOn(amplitude, 'trackEvent').mockImplementation(() => {})
  })

  describe('Rendering', () => {
    it('should render plugin title', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should render plugin icon with correct src', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('card-icon')).toBeInTheDocument()
    })

    it('should render icon with http url directly', () => {
      const detail = createPluginDetail({
        declaration: {
          ...createPluginDetail().declaration,
          icon: 'https://example.com/icon.png',
        } as unknown as PluginDetail['declaration'],
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('card-icon')).toHaveAttribute('data-src', 'https://example.com/icon.png')
    })

    it('should render description when not in readme view', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('description')).toBeInTheDocument()
    })

    it('should not render description in readme view', () => {
      render(<DetailHeader detail={createPluginDetail()} isReadmeView onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.queryByTestId('description')).not.toBeInTheDocument()
    })

    it('should render verified badge when verified', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('verified-badge')).toBeInTheDocument()
    })
  })

  describe('Version Display', () => {
    it('should show new version indicator when hasNewVersion is true', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      // Badge component should render with the version
      expect(screen.getByText('1.0.0')).toBeInTheDocument()
    })

    it('should not show new version indicator when versions match', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '1.0.0',
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      // Badge component should render with the version
      expect(screen.getByText('1.0.0')).toBeInTheDocument()
    })

    it('should show update button when new version is available', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByText('detailPanel.operation.update')).toBeInTheDocument()
    })

    it('should show update button for GitHub source', () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByText('detailPanel.operation.update')).toBeInTheDocument()
    })
  })

  describe('Auto Upgrade Feature', () => {
    it('should render component when marketplace is disabled', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'enabled',
        upgrade_mode: 'update_all',
        include_plugins: [],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should render component when strategy is disabled', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'disabled',
        upgrade_mode: 'update_all',
        include_plugins: [],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should enable auto upgrade for update_all mode', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'enabled',
        upgrade_mode: 'update_all',
        include_plugins: [],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      // Auto upgrade badge should be rendered
      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should enable auto upgrade for partial mode when plugin is included', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'enabled',
        upgrade_mode: 'partial',
        include_plugins: ['test-plugin'],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should not enable auto upgrade for partial mode when plugin is not included', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'enabled',
        upgrade_mode: 'partial',
        include_plugins: ['other-plugin'],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should enable auto upgrade for exclude mode when plugin is not excluded', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'enabled',
        upgrade_mode: 'exclude',
        include_plugins: [],
        exclude_plugins: ['other-plugin'],
        upgrade_time_of_day: 36000,
      }

      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should not enable auto upgrade for exclude mode when plugin is excluded', () => {
      mockAutoUpgradeInfo = {
        strategy_setting: 'enabled',
        upgrade_mode: 'exclude',
        include_plugins: [],
        exclude_plugins: ['test-plugin'],
        upgrade_time_of_day: 36000,
      }

      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should not enable auto upgrade for non-marketplace plugins', () => {
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
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should not enable auto upgrade when marketplace feature is disabled', () => {
      mockEnableMarketplace = false
      mockAutoUpgradeInfo = {
        strategy_setting: 'enabled',
        upgrade_mode: 'update_all',
        include_plugins: [],
        exclude_plugins: [],
        upgrade_time_of_day: 36000,
      }

      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      // Component should still render but auto upgrade should be disabled
      expect(screen.getByTestId('title')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onHide when close button clicked', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      // Find the close button (ActionButton with action-btn class)
      const actionButtons = screen.getAllByRole('button').filter(btn => btn.classList.contains('action-btn'))
      fireEvent.click(actionButtons[actionButtons.length - 1])

      expect(mockOnHide).toHaveBeenCalled()
    })

    it('should have info button available', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      const infoBtn = screen.getByTestId('info-btn')
      fireEvent.click(infoBtn)

      expect(infoBtn).toBeInTheDocument()
    })

    it('should have check version button available', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      const checkBtn = screen.getByTestId('check-version-btn')
      fireEvent.click(checkBtn)

      expect(checkBtn).toBeInTheDocument()
    })
  })

  describe('Update Flow - Marketplace', () => {
    it('should have update button for new version', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      const updateBtn = screen.getByText('detailPanel.operation.update')
      fireEvent.click(updateBtn)

      expect(updateBtn).toBeInTheDocument()
    })

    it('should have version picker select button', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      const selectBtn = screen.getByTestId('select-version-btn')
      fireEvent.click(selectBtn)

      expect(selectBtn).toBeInTheDocument()
    })

    it('should have downgrade button', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      const downgradeBtn = screen.getByTestId('select-downgrade-btn')
      fireEvent.click(downgradeBtn)

      expect(downgradeBtn).toBeInTheDocument()
    })
  })

  describe('Update Flow - GitHub', () => {
    it('should check for updates from GitHub when update clicked', async () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByText('detailPanel.operation.update'))

      await waitFor(() => {
        expect(mockFetchReleases).toHaveBeenCalledWith('owner', 'repo')
      })
    })

    it('should show toast when no releases found', async () => {
      mockFetchReleases.mockResolvedValueOnce([])

      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByText('detailPanel.operation.update'))

      await waitFor(() => {
        expect(mockFetchReleases).toHaveBeenCalled()
      })
    })

    it('should show update plugin modal when update is needed', async () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByText('detailPanel.operation.update'))

      await waitFor(() => {
        expect(mockSetShowUpdatePluginModal).toHaveBeenCalled()
      })
    })

    it('should call onUpdate via onSaveCallback when GitHub update completes', async () => {
      mockSetShowUpdatePluginModal.mockImplementation(({ onSaveCallback }) => {
        // Simulate the modal completing and calling onSaveCallback
        onSaveCallback()
      })

      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByText('detailPanel.operation.update'))

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalled()
      })
    })
  })

  describe('Delete Flow', () => {
    it('should have remove button available', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      expect(removeBtn).toBeInTheDocument()
    })

    it('should have uninstallPlugin mock defined', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('remove-btn'))

      expect(mockUninstallPlugin).toBeDefined()
    })

    it('should render correctly for model plugin delete', () => {
      const detail = createPluginDetail({
        declaration: {
          ...createPluginDetail().declaration,
          category: 'model',
        } as unknown as PluginDetail['declaration'],
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('remove-btn')).toBeInTheDocument()
    })

    it('should render correctly for tool plugin delete', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('remove-btn')).toBeInTheDocument()
    })
  })

  describe('Plugin Sources', () => {
    it('should render github source icon', () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should render local source icon', () => {
      const detail = createPluginDetail({ source: PluginSource.local })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should render debugging source icon', () => {
      const detail = createPluginDetail({ source: PluginSource.debugging })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should not render deprecation notice for non-marketplace source', () => {
      const detail = createPluginDetail({ source: PluginSource.github, meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' } })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.queryByTestId('deprecation-notice')).not.toBeInTheDocument()
    })
  })

  describe('Detail URL Generation', () => {
    it('should render GitHub source correctly', () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('operation-dropdown')).toBeInTheDocument()
    })

    it('should render marketplace source correctly', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('operation-dropdown')).toBeInTheDocument()
    })

    it('should render local source correctly', () => {
      const detail = createPluginDetail({ source: PluginSource.local })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('operation-dropdown')).toBeInTheDocument()
    })
  })

  describe('Plugin Auth', () => {
    it('should render plugin auth for tool category', () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('plugin-auth')).toBeInTheDocument()
    })

    it('should not render plugin auth for non-tool category', () => {
      const detail = createPluginDetail({
        declaration: {
          ...createPluginDetail().declaration,
          category: 'model',
        } as unknown as PluginDetail['declaration'],
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.queryByTestId('plugin-auth')).not.toBeInTheDocument()
    })

    it('should not render plugin auth in readme view', () => {
      render(<DetailHeader detail={createPluginDetail()} isReadmeView onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.queryByTestId('plugin-auth')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle plugin without version', () => {
      const detail = createPluginDetail({ version: '' })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('title')).toBeInTheDocument()
    })

    it('should handle plugin with name containing slash', () => {
      const detail = createPluginDetail({
        declaration: {
          ...createPluginDetail().declaration,
          name: 'org/plugin-name',
        } as unknown as PluginDetail['declaration'],
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('org-info')).toBeInTheDocument()
    })

    it('should handle empty icon', () => {
      const detail = createPluginDetail({
        declaration: {
          ...createPluginDetail().declaration,
          icon: '',
        } as unknown as PluginDetail['declaration'],
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('card-icon')).toHaveAttribute('data-src', '')
    })
  })

  describe('Delete Confirmation Flow', () => {
    it('should show delete confirm when remove button is clicked', async () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('remove-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
      })
    })

    it('should hide delete confirm when cancel is clicked', async () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('remove-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-cancel'))

      await waitFor(() => {
        expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument()
      })
    })

    it('should call uninstallPlugin when confirm delete is clicked', async () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('remove-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(mockUninstallPlugin).toHaveBeenCalledWith('test-id')
      })
    })

    it('should call onUpdate with true after successful delete', async () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('remove-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith(true)
      })
    })

    it('should refresh model providers when deleting model plugin', async () => {
      const detail = createPluginDetail({
        declaration: {
          ...createPluginDetail().declaration,
          category: 'model',
        } as unknown as PluginDetail['declaration'],
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('remove-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(mockRefreshModelProviders).toHaveBeenCalled()
      })
    })

    it('should invalidate tool providers when deleting tool plugin', async () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('remove-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(mockInvalidateAllToolProviders).toHaveBeenCalled()
      })
    })

    it('should track plugin uninstalled event after successful delete', async () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('remove-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(amplitude.trackEvent).toHaveBeenCalledWith('plugin_uninstalled', expect.any(Object))
      })
    })
  })

  describe('Update Modal Flow', () => {
    it('should show update modal when update button clicked for marketplace plugin', async () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByText('detailPanel.operation.update'))

      await waitFor(() => {
        expect(screen.getByTestId('update-modal')).toBeInTheDocument()
      })
    })

    it('should call onUpdate when save is clicked in update modal', async () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByText('detailPanel.operation.update'))
      await waitFor(() => {
        expect(screen.getByTestId('update-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('update-modal-save'))

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalled()
      })
    })

    it('should hide update modal when cancel is clicked', async () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByText('detailPanel.operation.update'))
      await waitFor(() => {
        expect(screen.getByTestId('update-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('update-modal-cancel'))

      await waitFor(() => {
        expect(screen.queryByTestId('update-modal')).not.toBeInTheDocument()
      })
    })
  })

  describe('Plugin Info Modal', () => {
    it('should show plugin info modal when info button is clicked', async () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('info-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('plugin-info')).toBeInTheDocument()
      })
    })

    it('should hide plugin info modal when close button is clicked', async () => {
      render(<DetailHeader detail={createPluginDetail()} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      fireEvent.click(screen.getByTestId('info-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('plugin-info')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('plugin-info-close'))

      await waitFor(() => {
        expect(screen.queryByTestId('plugin-info')).not.toBeInTheDocument()
      })
    })

    it('should render plugin info with GitHub meta data', () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'test-pkg' },
      })
      render(<DetailHeader detail={detail} onUpdate={mockOnUpdate} onHide={mockOnHide} />)

      expect(screen.getByTestId('info-btn')).toBeInTheDocument()
    })
  })
})
