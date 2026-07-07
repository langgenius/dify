import type { ReactElement, ReactNode } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { PluginSource } from '@/app/components/plugins/types'
import ProviderCardActions from '../provider-card-actions'

const mockHandleUpdate = vi.fn()
const mockHandleUpdatedFromMarketplace = vi.fn()
const mockHandleDelete = vi.fn()
const mockGetMarketplaceUrl = vi.fn()
const mockShowPluginInfo = vi.fn()
const mockShowDeleteConfirm = vi.fn()
const mockSetTargetVersion = vi.fn()
const mockSetVersionPickerOpen = vi.fn()

let mockHeaderState = {
  modalStates: {
    showPluginInfo: mockShowPluginInfo,
    showDeleteConfirm: mockShowDeleteConfirm,
  },
  versionPicker: {
    isShow: false,
    setIsShow: mockSetVersionPickerOpen,
    setTargetVersion: mockSetTargetVersion,
    targetVersion: undefined,
    isDowngrade: false,
  },
  hasNewVersion: true,
  isAutoUpgradeEnabled: false,
  isFromMarketplace: true,
  isFromGitHub: false,
}

const render = (ui: ReactElement) =>
  renderWithSystemFeatures(ui, { systemFeatures: { enable_marketplace: true } })

const openActionsMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }))
}

vi.mock('@/app/components/plugins/plugin-detail-panel/detail-header/hooks', () => ({
  useDetailHeaderState: () => mockHeaderState,
  usePluginOperations: () => ({
    handleUpdate: mockHandleUpdate,
    handleUpdatedFromMarketplace: mockHandleUpdatedFromMarketplace,
    handleDelete: mockHandleDelete,
  }),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/detail-header/components', () => ({
  HeaderModals: ({ targetVersion, isDowngrade, isAutoUpgradeEnabled }: {
    targetVersion?: { version: string, unique_identifier: string }
    isDowngrade: boolean
    isAutoUpgradeEnabled: boolean
  }) => (
    <div
      data-testid="header-modals"
      data-target-version={targetVersion?.version ?? ''}
      data-is-downgrade={String(isDowngrade)}
      data-auto-upgrade={String(isAutoUpgradeEnabled)}
    />
  ),
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  usePluginSettingsAccess: () => ({
    canDeletePlugin: true,
    canUpdatePlugin: true,
  }),
  default: () => ({
    canUpdate: true,
  }),
}))

vi.mock('@/app/components/plugins/update-plugin/plugin-version-picker', () => ({
  default: ({ trigger, onSelect, disabled }: {
    trigger: ReactNode
    onSelect: (state: { version: string, unique_identifier: string, isDowngrade?: boolean }) => void
    disabled?: boolean
  }) => (
    <div data-testid="plugin-version-picker" data-disabled={String(Boolean(disabled))}>
      {trigger}
      <button
        type="button"
        onClick={() => onSelect({ version: '2.0.0', unique_identifier: 'plugin@2.0.0', isDowngrade: true })}
      >
        select version
      </button>
    </div>
  ),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (...args: unknown[]) => mockGetMarketplaceUrl(...args),
}))

const createDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  plugin_id: 'plugin-id',
  plugin_unique_identifier: 'plugin-id@1.0.0',
  name: 'provider-plugin',
  source: PluginSource.marketplace,
  version: '1.0.0',
  latest_version: '2.0.0',
  latest_unique_identifier: 'plugin-id@2.0.0',
  declaration: {
    author: 'langgenius',
    name: 'provider-plugin',
  },
  meta: undefined,
  ...overrides,
} as PluginDetail)

describe('ProviderCardActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHeaderState = {
      modalStates: {
        showPluginInfo: mockShowPluginInfo,
        showDeleteConfirm: mockShowDeleteConfirm,
      },
      versionPicker: {
        isShow: false,
        setIsShow: mockSetVersionPickerOpen,
        setTargetVersion: mockSetTargetVersion,
        targetVersion: undefined,
        isDowngrade: false,
      },
      hasNewVersion: true,
      isAutoUpgradeEnabled: false,
      isFromMarketplace: true,
      isFromGitHub: false,
    }
    mockGetMarketplaceUrl.mockReturnValue('https://marketplace.example.com/plugins/langgenius/provider-plugin')
  })

  it('should render version controls for marketplace plugins and handle manual version selection', () => {
    render(<ProviderCardActions detail={createDetail()} />)

    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-version-picker')).toHaveAttribute('data-disabled', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'select version' }))

    expect(mockSetTargetVersion).toHaveBeenCalledWith({
      version: '2.0.0',
      unique_identifier: 'plugin@2.0.0',
      isDowngrade: true,
    })
    expect(mockHandleUpdate).toHaveBeenCalledWith(true)
  })

  it('should show a compact debug badge after the version for debugging plugins', () => {
    render(<ProviderCardActions detail={createDetail({ source: PluginSource.debugging })} />)

    const version = screen.getByText('1.0.0')
    const debugBadge = screen.getByText('appDebug.operation.debugConfig')

    expect(version.compareDocumentPosition(debugBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('should trigger the latest marketplace update when clicking the update button', () => {
    render(<ProviderCardActions detail={createDetail()} />)

    fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))

    expect(mockSetTargetVersion).toHaveBeenCalledWith({
      version: '2.0.0',
      unique_identifier: 'plugin-id@2.0.0',
    })
    expect(mockHandleUpdate).toHaveBeenCalledWith()
  })

  it('should pass the marketplace detail url to the operation dropdown', () => {
    render(<ProviderCardActions detail={createDetail()} />)

    expect(mockGetMarketplaceUrl).toHaveBeenCalledWith('/plugins/langgenius/provider-plugin', {
      language: 'en-US',
      theme: 'light',
    })
    openActionsMenu()
    expect(screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' })).toHaveAttribute(
      'href',
      'https://marketplace.example.com/plugins/langgenius/provider-plugin',
    )
  })

  it('should relay the marketplace remove action', () => {
    render(<ProviderCardActions detail={createDetail()} />)

    openActionsMenu()
    fireEvent.click(screen.getByText('plugin.detailPanel.operation.remove'))

    expect(mockShowDeleteConfirm).toHaveBeenCalledTimes(1)
  })

  it('should use the GitHub repo url and skip marketplace version preselection for GitHub plugins', () => {
    mockHeaderState = {
      ...mockHeaderState,
      hasNewVersion: false,
      isFromMarketplace: false,
      isFromGitHub: true,
    }

    render(
      <ProviderCardActions detail={createDetail({
        source: PluginSource.github,
        meta: {
          repo: 'langgenius/provider-plugin',
          version: '1.0.0',
          package: 'provider-plugin.difypkg',
        },
      })}
      />,
    )

    expect(screen.getByTestId('plugin-version-picker')).toHaveAttribute('data-disabled', 'true')
    openActionsMenu()
    expect(screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' })).toHaveAttribute('href', 'https://github.com/langgenius/provider-plugin')

    fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))

    expect(mockSetTargetVersion).not.toHaveBeenCalled()
    expect(mockHandleUpdate).toHaveBeenCalledWith()
  })

  it('should relay GitHub operation dropdown actions', () => {
    mockHeaderState = {
      ...mockHeaderState,
      hasNewVersion: false,
      isFromMarketplace: false,
      isFromGitHub: true,
    }

    render(
      <ProviderCardActions detail={createDetail({
        source: PluginSource.github,
        meta: {
          repo: 'langgenius/provider-plugin',
          version: '1.0.0',
          package: 'provider-plugin.difypkg',
        },
      })}
      />,
    )

    openActionsMenu()
    fireEvent.click(screen.getByText('plugin.detailPanel.operation.info'))
    openActionsMenu()
    fireEvent.click(screen.getByText('plugin.detailPanel.operation.checkUpdate'))
    openActionsMenu()
    fireEvent.click(screen.getByText('plugin.detailPanel.operation.remove'))

    expect(mockShowPluginInfo).toHaveBeenCalledTimes(1)
    expect(mockHandleUpdate).toHaveBeenCalledTimes(1)
    expect(mockShowDeleteConfirm).toHaveBeenCalledTimes(1)
  })

  it('should fall back to the detail name when declaration metadata is missing', () => {
    render(
      <ProviderCardActions
        detail={createDetail({
          declaration: undefined,
        })}
      />,
    )

    expect(mockGetMarketplaceUrl).toHaveBeenCalledWith('/plugins//provider-plugin', {
      language: 'en-US',
      theme: 'light',
    })
  })

  it('should leave the detail url empty when a GitHub plugin has no repo or the source is unsupported', () => {
    const { rerender } = render(
      <ProviderCardActions
        detail={createDetail({
          source: PluginSource.github,
          meta: undefined,
        })}
      />,
    )

    openActionsMenu()
    expect(screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' })).toHaveAttribute('href', '')

    rerender(
      <ProviderCardActions
        detail={createDetail({
          source: PluginSource.local,
        })}
      />,
    )

    openActionsMenu()
    expect(screen.queryByText('plugin.detailPanel.operation.viewDetail')).not.toBeInTheDocument()
  })
})
