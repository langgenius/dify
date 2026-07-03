import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import PluginCategoryPage from '../plugin-category-page'

const {
  mockContainerRef,
  mockFetchManifestFromMarketPlace,
  mockSetInstallState,
  mockUseUploader,
  mockUsePluginInstallation,
  mockPluginInstallationPermission,
} = vi.hoisted(() => ({
  mockContainerRef: { current: null },
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

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useSuspenseQuery: () => ({ data: mockPluginInstallationPermission }),
}))

vi.mock('@/app/components/plugins/plugin-page/context-provider', () => ({
  PluginPageContextProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/components/plugins/plugin-page/context', () => ({
  usePluginPageContext: (selector: (value: {
    containerRef: typeof mockContainerRef
  }) => unknown) => selector({ containerRef: mockContainerRef }),
}))

vi.mock('@/app/components/plugins/plugin-page/plugins-panel', () => ({
  default: ({ canInstall, fixedCategory, onSwitchToMarketplace }: { canInstall?: boolean, fixedCategory: PluginCategoryEnum, onSwitchToMarketplace?: () => void }) => (
    <div data-can-install={canInstall ? 'true' : 'false'} data-fixed-category={fixedCategory} data-has-marketplace-action={onSwitchToMarketplace ? 'true' : 'false'} data-testid="plugins-panel" />
  ),
}))

vi.mock('@/app/components/plugins/plugin-page/use-uploader', () => ({
  useUploader: (options: unknown) => mockUseUploader(options),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({ file, installContextCategory }: { file: File, installContextCategory?: PluginCategoryEnum }) => (
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
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}))

vi.mock('@/hooks/use-query-params', () => ({
  usePluginInstallation: () => mockUsePluginInstallation(),
}))

vi.mock('@/service/plugins', () => ({
  fetchManifestFromMarketPlace: (...args: unknown[]) => mockFetchManifestFromMarketPlace(...args),
}))

type UploaderOptions = {
  onFileChange: (file: File | null) => void
}

describe('PluginCategoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPluginInstallationPermission.restrict_to_marketplace_only = false
    mockUsePluginInstallation.mockReturnValue([{ packageId: null, bundleInfo: null }, mockSetInstallState])
  })

  it.each([
    [PluginCategoryEnum.tool, true],
    [PluginCategoryEnum.trigger, true],
    [PluginCategoryEnum.agent, true],
    [PluginCategoryEnum.extension, true],
  ])('sets drop install availability for %s', (category, enabled) => {
    render(<PluginCategoryPage category={category} />)

    expect(mockUseUploader).toHaveBeenCalledWith(expect.objectContaining({
      enabled,
    }))
  })

  it('uses the Figma panel background for scoped integration categories', () => {
    const { container } = render(<PluginCategoryPage category={PluginCategoryEnum.trigger} />)

    expect(container.firstElementChild).toHaveClass('bg-components-panel-bg')
  })

  it('passes the marketplace action to the plugins panel', () => {
    const onSwitchToMarketplace = vi.fn()

    render(<PluginCategoryPage category={PluginCategoryEnum.extension} onSwitchToMarketplace={onSwitchToMarketplace} />)

    expect(screen.getByTestId('plugins-panel')).toHaveAttribute('data-has-marketplace-action', 'true')
  })

  it('disables drop install when local packages are restricted', () => {
    mockPluginInstallationPermission.restrict_to_marketplace_only = true

    render(<PluginCategoryPage category={PluginCategoryEnum.agent} />)

    expect(mockUseUploader).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
    }))
  })

  it('disables panel and drop installs when install permission is unavailable', () => {
    render(<PluginCategoryPage canInstall={false} category={PluginCategoryEnum.agent} />)

    expect(screen.getByTestId('plugins-panel')).toHaveAttribute('data-can-install', 'false')
    expect(mockUseUploader).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
    }))
  })

  it('keeps marketplace install params while install permission is loading', async () => {
    const packageId = 'junjiem/mcp_see_agent:0.2.4@82caf96890992e9dec2c43c3fac82bfce8bd18a41de7c2b6948151b2d7f7b7a2'
    mockUsePluginInstallation.mockReturnValue([{ packageId, bundleInfo: null }, mockSetInstallState])

    render(<PluginCategoryPage canInstall={false} isInstallPermissionLoading category={PluginCategoryEnum.agent} />)

    await waitFor(() => {
      expect(mockUseUploader).toHaveBeenCalled()
    })
    expect(mockFetchManifestFromMarketPlace).not.toHaveBeenCalled()
    expect(mockSetInstallState).not.toHaveBeenCalled()
    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })

  it('clears marketplace install params when install permission is unavailable after loading', async () => {
    const packageId = 'junjiem/mcp_see_agent:0.2.4@82caf96890992e9dec2c43c3fac82bfce8bd18a41de7c2b6948151b2d7f7b7a2'
    mockUsePluginInstallation.mockReturnValue([{ packageId, bundleInfo: null }, mockSetInstallState])

    render(<PluginCategoryPage canInstall={false} category={PluginCategoryEnum.agent} />)

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

    expect(screen.getByTestId('install-from-local-package')).toHaveAttribute('data-file-name', 'tool.difypkg')
    expect(screen.getByTestId('install-from-local-package')).toHaveAttribute('data-install-context-category', PluginCategoryEnum.tool)
  })

  it('opens the marketplace installer from package id query params', async () => {
    const packageId = 'langgenius/telegram_trigger:0.0.6@923a18de89d8cdb7f419d0dff60bf08a8b81b65fef6bf606cf0ce4b0ee56a9ca'
    mockUsePluginInstallation.mockReturnValue([{ packageId, bundleInfo: null }, mockSetInstallState])
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
      expect(screen.getByTestId('install-from-marketplace')).toHaveAttribute('data-unique-identifier', packageId)
    })
    expect(screen.getByTestId('install-from-marketplace')).toHaveAttribute('data-install-context-category', PluginCategoryEnum.trigger)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(mockSetInstallState).toHaveBeenCalledWith(null)
  })

  it('ignores dropped files when install permission is unavailable', () => {
    render(<PluginCategoryPage canInstall={false} category={PluginCategoryEnum.agent} />)

    const uploaderOptions = mockUseUploader.mock.calls[0]![0] as UploaderOptions
    act(() => {
      uploaderOptions.onFileChange(new File(['test'], 'agent.difybndl'))
    })

    expect(screen.queryByTestId('install-from-local-package')).not.toBeInTheDocument()
  })
})
