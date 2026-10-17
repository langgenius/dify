import type { ReactElement } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import PluginCategoryPage from '../plugin-category-page'

const {
  mockFetchManifestFromMarketPlace,
  mockSetInstallState,
  mockUseUploader,
  mockUsePluginInstallation,
  mockPluginInstallationPermission,
} = vi.hoisted(() => ({
  mockFetchManifestFromMarketPlace: vi.fn(),
  mockSetInstallState: vi.fn(),
  mockUseUploader: vi.fn((_: unknown) => ({
    dragging: false,
    fileUploader: { current: null },
    fileChangeHandle: undefined,
    removeFile: undefined,
  })),
  mockUsePluginInstallation: vi.fn(),
  mockPluginInstallationPermission: {
    restrict_to_marketplace_only: false,
  },
}))

const renderWithUrl = createNuqsTestRenderer(renderWithConsoleQuery)
const render = (ui: ReactElement) =>
  renderWithUrl(ui, {
    systemFeatures: { plugin_installation_permission: mockPluginInstallationPermission },
  })

vi.mock('@/app/components/plugins/plugin-page/plugins-panel', () => ({
  default: ({
    canInstall,
    fixedCategory,
    onSwitchToMarketplace,
  }: {
    canInstall?: boolean
    fixedCategory: PluginCategoryEnum
    onSwitchToMarketplace?: () => void
  }) => (
    <div
      data-can-install={canInstall ? 'true' : 'false'}
      data-fixed-category={fixedCategory}
      data-has-marketplace-action={onSwitchToMarketplace ? 'true' : 'false'}
      data-testid="plugins-panel"
    >
      {onSwitchToMarketplace && (
        <button type="button" onClick={onSwitchToMarketplace}>
          marketplace
        </button>
      )}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-page/use-uploader', () => ({
  useUploader: (options: unknown) => mockUseUploader(options),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({
    file,
    installContextCategory,
  }: {
    file: File
    installContextCategory?: PluginCategoryEnum
  }) => (
    <div
      data-testid="install-from-local-package"
      data-file-name={file.name}
      data-install-context-category={installContextCategory}
    />
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({
    installContextCategory,
    onClose,
    uniqueIdentifier,
  }: {
    installContextCategory?: PluginCategoryEnum
    onClose: () => void
    uniqueIdentifier: string
  }) => (
    <div
      data-testid="install-from-marketplace"
      data-install-context-category={installContextCategory}
      data-unique-identifier={uniqueIdentifier}
    >
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}))

vi.mock('@/hooks/use-query-params', () => ({
  usePluginInstallation: () => mockUsePluginInstallation(),
}))

vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  fetchManifestFromMarketPlace: (...args: unknown[]) => mockFetchManifestFromMarketPlace(...args),
}))

type UploaderOptions = {
  onFileChange: (file: File | null) => void
}

describe('PluginCategoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchManifestFromMarketPlace.mockReset()
    mockPluginInstallationPermission.restrict_to_marketplace_only = false
    mockUsePluginInstallation.mockReturnValue([
      { packageId: null, bundleInfo: null },
      mockSetInstallState,
    ])
  })

  it.each([
    [PluginCategoryEnum.tool, true],
    [PluginCategoryEnum.trigger, false],
    [PluginCategoryEnum.agent, false],
    [PluginCategoryEnum.extension, false],
  ])('sets drop install availability for %s', (category, enabled) => {
    render(<PluginCategoryPage category={category} />)

    expect(mockUseUploader).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled,
      }),
    )
  })

  it('opens the marketplace through the plugins panel action', async () => {
    const onSwitchToMarketplace = vi.fn()

    render(
      <PluginCategoryPage
        category={PluginCategoryEnum.extension}
        onSwitchToMarketplace={onSwitchToMarketplace}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'marketplace' }))
    expect(onSwitchToMarketplace).toHaveBeenCalledTimes(1)
  })

  it('disables drop install when local packages are restricted', () => {
    mockPluginInstallationPermission.restrict_to_marketplace_only = true

    render(<PluginCategoryPage category={PluginCategoryEnum.tool} />)

    expect(mockUseUploader).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    )
  })

  it('disables panel and drop installs when install permission is unavailable', () => {
    render(<PluginCategoryPage canInstall={false} category={PluginCategoryEnum.tool} />)

    expect(screen.getByTestId('plugins-panel')).toHaveAttribute('data-can-install', 'false')
    expect(mockUseUploader).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    )
  })

  it('keeps marketplace install params while install permission is loading', async () => {
    const packageId =
      'junjiem/mcp_see_agent:0.2.4@82caf96890992e9dec2c43c3fac82bfce8bd18a41de7c2b6948151b2d7f7b7a2'
    mockUsePluginInstallation.mockReturnValue([
      { packageId, bundleInfo: null },
      mockSetInstallState,
    ])

    render(
      <PluginCategoryPage
        canInstall={false}
        isInstallPermissionLoading
        category={PluginCategoryEnum.agent}
      />,
    )

    await waitFor(() => {
      expect(mockUseUploader).toHaveBeenCalled()
    })
    expect(mockFetchManifestFromMarketPlace).not.toHaveBeenCalled()
    expect(mockSetInstallState).not.toHaveBeenCalled()
    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })

  it('clears marketplace install params when install permission is unavailable after loading', async () => {
    const packageId =
      'junjiem/mcp_see_agent:0.2.4@82caf96890992e9dec2c43c3fac82bfce8bd18a41de7c2b6948151b2d7f7b7a2'
    mockUsePluginInstallation.mockReturnValue([
      { packageId, bundleInfo: null },
      mockSetInstallState,
    ])

    render(<PluginCategoryPage canInstall={false} category={PluginCategoryEnum.tool} />)

    await waitFor(() => {
      expect(mockSetInstallState).toHaveBeenCalledWith(null)
    })
    expect(mockFetchManifestFromMarketPlace).not.toHaveBeenCalled()
    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })

  it('opens the local package installer for supported dropped files', () => {
    render(<PluginCategoryPage category={PluginCategoryEnum.tool} />)

    const uploaderOptions = mockUseUploader.mock.calls[0]![0] as UploaderOptions
    act(() => {
      uploaderOptions.onFileChange(new File(['test'], 'tool.difypkg'))
    })

    expect(screen.getByTestId('install-from-local-package')).toHaveAttribute(
      'data-file-name',
      'tool.difypkg',
    )
    expect(screen.getByTestId('install-from-local-package')).toHaveAttribute(
      'data-install-context-category',
      PluginCategoryEnum.tool,
    )
  })

  it('opens the marketplace installer from package id query params', async () => {
    const packageId =
      'langgenius/telegram_trigger:0.0.6@923a18de89d8cdb7f419d0dff60bf08a8b81b65fef6bf606cf0ce4b0ee56a9ca'
    mockUsePluginInstallation.mockReturnValue([
      { packageId, bundleInfo: null },
      mockSetInstallState,
    ])
    mockFetchManifestFromMarketPlace.mockResolvedValue({
      data: {
        plugin: {
          org: 'langgenius',
          name: 'telegram_trigger',
          category: PluginCategoryEnum.trigger,
        },
        version: { version: '0.0.6' },
      },
    })

    render(<PluginCategoryPage category={PluginCategoryEnum.trigger} />)

    await waitFor(() => {
      expect(mockFetchManifestFromMarketPlace).toHaveBeenCalledWith(encodeURIComponent(packageId))
      expect(screen.getByTestId('install-from-marketplace')).toHaveAttribute(
        'data-unique-identifier',
        packageId,
      )
    })
    expect(screen.getByTestId('install-from-marketplace')).toHaveAttribute(
      'data-install-context-category',
      PluginCategoryEnum.trigger,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'close' }))

    expect(mockSetInstallState).toHaveBeenCalledWith(null)
  })

  it('ignores dropped files when install permission is unavailable', () => {
    render(<PluginCategoryPage canInstall={false} category={PluginCategoryEnum.tool} />)

    const uploaderOptions = mockUseUploader.mock.calls[0]![0] as UploaderOptions
    act(() => {
      uploaderOptions.onFileChange(new File(['test'], 'agent.difybndl'))
    })

    expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()
  })
})
