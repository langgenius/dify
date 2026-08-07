import type { ReactElement } from 'react'
import type { ModelProviderPluginSummary } from '../../index'
import type { PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginSource } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/client'
import { commonQueryKeys } from '@/service/use-common'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import ProviderCardActions from '../provider-card-actions'

const mockHandleUpdate = vi.fn()
const mockHandleUpdatedFromMarketplace = vi.fn()
const mockHandleDelete = vi.fn()
const mockGetMarketplaceUrl = vi.fn()
const mockShowPluginInfo = vi.fn()
const mockShowDeleteConfirm = vi.fn()
const mockSetTargetVersion = vi.fn()
const mockSetVersionPickerOpen = vi.fn()
const { mockNormalizeInstalledPluginDetail, mockUninstallPlugin, mockUseVersionListOfPlugin } =
  vi.hoisted(() => ({
    mockNormalizeInstalledPluginDetail: vi.fn(),
    mockUninstallPlugin: vi.fn(),
    mockUseVersionListOfPlugin: vi.fn(),
  }))
const mockPluginSettingsAccess = vi.hoisted(() => ({
  canDeletePlugin: true,
  canUpdatePlugin: true,
}))

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
  renderWithConsoleQuery(ui, { systemFeatures: { enable_marketplace: true } })

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
  HeaderModals: ({
    targetVersion,
    isDowngrade,
    isAutoUpgradeEnabled,
  }: {
    targetVersion?: { version: string; unique_identifier: string }
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
  usePluginSettingsAccess: () => mockPluginSettingsAccess,
  default: () => ({
    canUpdate: true,
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (...args: unknown[]) => mockGetMarketplaceUrl(...args),
}))

vi.mock('@/service/plugins', () => ({
  uninstallPlugin: mockUninstallPlugin,
}))

vi.mock('@/service/use-plugins', () => ({
  normalizeInstalledPluginDetail: mockNormalizeInstalledPluginDetail,
  useVersionListOfPlugin: mockUseVersionListOfPlugin,
}))

const createDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail =>
  ({
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
  }) as PluginDetail

const createSummary = (
  overrides: Partial<ModelProviderPluginSummary> = {},
): ModelProviderPluginSummary => ({
  installation_id: 'installation-id',
  plugin_id: 'langgenius/provider-plugin',
  plugin_unique_identifier: 'langgenius/provider-plugin@1.0.0',
  runtime_type: 'local',
  source: 'github',
  version: '1.0.0',
  ...overrides,
})

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
    mockGetMarketplaceUrl.mockReturnValue(
      'https://marketplace.example.com/plugins/langgenius/provider-plugin',
    )
    mockNormalizeInstalledPluginDetail.mockReturnValue(
      createDetail({
        source: PluginSource.github,
        meta: {
          repo: 'langgenius/provider-plugin',
          version: '1.0.0',
          package: 'provider-plugin.difypkg',
        },
      }),
    )
    mockUninstallPlugin.mockResolvedValue({ success: true })
    mockUseVersionListOfPlugin.mockReturnValue({
      data: {
        data: {
          versions: [
            {
              version: '0.9.0',
              unique_identifier: 'plugin@0.9.0',
              created_at: 0,
            },
          ],
        },
      },
      isLoading: false,
    })
    mockPluginSettingsAccess.canDeletePlugin = true
    mockPluginSettingsAccess.canUpdatePlugin = true
  })

  it('should load plugin detail and continue the requested info action', async () => {
    mockHeaderState = {
      ...mockHeaderState,
      hasNewVersion: false,
      isFromMarketplace: false,
      isFromGitHub: true,
    }
    const rendered = render(
      <ProviderCardActions summary={createSummary()} providerLabel="Provider Plugin" />,
    )
    const fetchQuery = vi
      .spyOn(rendered.queryClient, 'fetchQuery')
      .mockResolvedValue({ plugins: [{}] })

    openActionsMenu()
    fireEvent.click(screen.getByText('plugin.detailPanel.operation.info'))

    await waitFor(() => {
      expect(mockShowPluginInfo).toHaveBeenCalledTimes(1)
    })
    expect(fetchQuery).toHaveBeenCalledTimes(1)
    expect(mockNormalizeInstalledPluginDetail).toHaveBeenCalledTimes(1)
  })

  it('should remove from summary without loading plugin detail', async () => {
    const rendered = render(
      <ProviderCardActions summary={createSummary()} providerLabel="Provider Plugin" />,
    )
    const fetchQuery = vi.spyOn(rendered.queryClient, 'fetchQuery')
    const invalidateQueries = vi.spyOn(rendered.queryClient, 'invalidateQueries')

    openActionsMenu()
    fireEvent.click(screen.getByText('plugin.detailPanel.operation.remove'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mockUninstallPlugin).toHaveBeenCalledWith('installation-id')
    })
    expect(fetchQuery).not.toHaveBeenCalled()
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.workspaces.current.plugin.installedIds.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.workspaces.current.plugin.list.installations.ids.post.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.workspaces.current.plugin.list.latestVersions.post.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: commonQueryKeys.modelProviderDetails,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['marketplacePlugins'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['marketplaceCollectionPlugins'] })
  })

  it('should only render an interactive summary version when marketplace updates are allowed', () => {
    const { rerender } = render(
      <ProviderCardActions summary={createSummary()} providerLabel="Provider Plugin" />,
    )

    expect(screen.queryByRole('button', { name: '1.0.0' })).not.toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()

    rerender(
      <ProviderCardActions
        summary={createSummary({ source: 'marketplace' })}
        providerLabel="Provider Plugin"
      />,
    )
    expect(screen.getByRole('button', { name: '1.0.0' })).toBeInTheDocument()

    mockPluginSettingsAccess.canUpdatePlugin = false
    rerender(
      <ProviderCardActions
        summary={createSummary({ source: 'marketplace' })}
        providerLabel="Provider Plugin"
      />,
    )
    expect(screen.queryByRole('button', { name: '1.0.0' })).not.toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
  })

  it('should use the summary latest version when updating a marketplace plugin', async () => {
    mockNormalizeInstalledPluginDetail.mockReturnValue(
      createDetail({
        latest_version: '1.0.0',
        latest_unique_identifier: 'plugin-id@1.0.0',
      }),
    )
    const rendered = render(
      <ProviderCardActions
        summary={createSummary({
          source: 'marketplace',
          latestVersion: '2.0.0',
          latestUniqueIdentifier: 'plugin-id@2.0.0',
        })}
        providerLabel="Provider Plugin"
      />,
    )
    vi.spyOn(rendered.queryClient, 'fetchQuery').mockResolvedValue({ plugins: [{}] })

    fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))

    await waitFor(() => {
      expect(mockSetTargetVersion).toHaveBeenCalledWith({
        version: '2.0.0',
        unique_identifier: 'plugin-id@2.0.0',
      })
    })
  })

  it('should render version controls for marketplace plugins and handle manual version selection', async () => {
    const user = userEvent.setup()
    mockHeaderState = {
      ...mockHeaderState,
      versionPicker: {
        ...mockHeaderState.versionPicker,
        isShow: true,
      },
    }
    render(<ProviderCardActions detail={createDetail()} />)

    expect(screen.getByRole('button', { name: '1.0.0' })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: /^0\.9\.0/ }))

    expect(mockSetTargetVersion).toHaveBeenCalledWith({
      version: '0.9.0',
      unique_identifier: 'plugin@0.9.0',
      isDowngrade: true,
    })
    expect(mockHandleUpdate).toHaveBeenCalledWith(true)
  })

  it('should show a compact debug badge after the version for debugging plugins', () => {
    render(<ProviderCardActions detail={createDetail({ source: PluginSource.debugging })} />)

    const version = screen.getByText('1.0.0')
    const debugBadge = screen.getByText('appDebug.operation.debugConfig')

    expect(
      version.compareDocumentPosition(debugBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
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

  it('should not update a marketplace plugin without a latest package identifier', () => {
    render(<ProviderCardActions detail={createDetail({ latest_unique_identifier: '' })} />)

    fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))

    expect(mockSetTargetVersion).not.toHaveBeenCalled()
    expect(mockHandleUpdate).not.toHaveBeenCalled()
  })

  it('should pass the marketplace detail url to the operation dropdown', () => {
    render(<ProviderCardActions detail={createDetail()} />)

    expect(mockGetMarketplaceUrl).toHaveBeenCalledWith('/plugins/langgenius/provider-plugin', {
      language: 'en-US',
      theme: 'light',
    })
    openActionsMenu()
    expect(
      screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' }),
    ).toHaveAttribute('href', 'https://marketplace.example.com/plugins/langgenius/provider-plugin')
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
      <ProviderCardActions
        detail={createDetail({
          source: PluginSource.github,
          meta: {
            repo: 'langgenius/provider-plugin',
            version: '1.0.0',
            package: 'provider-plugin.difypkg',
          },
        })}
      />,
    )

    expect(screen.getByRole('button', { name: '1.0.0' })).toBeDisabled()
    openActionsMenu()
    expect(
      screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' }),
    ).toHaveAttribute('href', 'https://github.com/langgenius/provider-plugin')

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
      <ProviderCardActions
        detail={createDetail({
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
    expect(
      screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewDetail' }),
    ).toHaveAttribute('href', '')

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
