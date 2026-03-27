import type { PackageDependency, Plugin, VersionProps } from '@/app/components/plugins/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { useUploadGitHub } from '@/service/use-plugins'
import GitHubItem from '../github-item'
import LoadedItem from '../loaded-item'
import MarketPlaceItem from '../marketplace-item'
import PackageItem from '../package-item'

const mockUseUploadGitHub = vi.mocked(useUploadGitHub)

let mockCanInstall = true
const mockGetIconUrl = vi.fn((icon: string) => `https://icons.example/${icon}`)
const mockPluginManifestToCardPluginProps = vi.fn()

vi.mock('@/service/use-plugins', () => ({
  useUploadGitHub: vi.fn(),
}))

vi.mock('@/app/components/plugins/install-plugin/base/use-get-icon', () => ({
  default: () => ({
    getIconUrl: mockGetIconUrl,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-install-plugin-limit', () => ({
  default: () => ({
    canInstall: mockCanInstall,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/utils', () => ({
  pluginManifestToCardPluginProps: (...args: unknown[]) => mockPluginManifestToCardPluginProps(...args),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, titleLeft, limitedInstall }: { payload: Plugin, titleLeft?: React.ReactNode, limitedInstall?: boolean }) => (
    <div
      data-testid="plugin-card"
      data-icon={payload.icon}
      data-plugin-id={payload.plugin_id}
      data-limited-install={String(!!limitedInstall)}
    >
      {titleLeft}
      <span>{payload.name}</span>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/base/version', () => ({
  default: ({ toInstallVersion }: VersionProps) => <span data-testid="version-badge">{toInstallVersion}</span>,
}))

vi.mock('@/app/components/plugins/install-plugin/base/loading', () => ({
  default: () => <div>loading</div>,
}))

vi.mock('@/app/components/plugins/install-plugin/base/loading-error', () => ({
  default: () => <div>loading-error</div>,
}))

const versionInfo: VersionProps = {
  hasInstalled: false,
  toInstallVersion: '0.0.1',
}

const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  plugin_id: 'plugin-id',
  type: 'tool',
  category: 'tool' as Plugin['category'],
  name: 'plugin-name',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'package-id',
  org: 'plugin-org',
  label: { en_US: 'Plugin Name' } as Plugin['label'],
  brief: { en_US: 'Plugin brief' } as Plugin['brief'],
  description: { en_US: 'Plugin description' } as Plugin['description'],
  icon: 'icon.png',
  verified: false,
  introduction: '',
  repository: '',
  install_count: 0,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'langgenius' },
  from: 'github',
  ...overrides,
})

const createPackageDependency = (overrides: Partial<PackageDependency> = {}): PackageDependency => ({
  type: 'package',
  value: {
    unique_identifier: 'package-uid',
    manifest: { plugin_unique_identifier: 'manifest-plugin-id' } as PackageDependency['value']['manifest'],
  },
  ...overrides,
})

describe('install bundle item components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanInstall = true
    mockUseUploadGitHub.mockReturnValue({
      data: undefined,
      error: undefined,
    } as unknown as ReturnType<typeof useUploadGitHub>)
    mockPluginManifestToCardPluginProps.mockReturnValue(createPlugin({
      plugin_id: 'manifest-plugin-id',
      from: 'package',
    }))
  })

  // Covers the base loaded card behavior for local and marketplace items.
  describe('LoadedItem', () => {
    it('should use local icon urls and emit the payload when selected', () => {
      const payload = createPlugin()
      const onCheckedChange = vi.fn()

      render(
        <LoadedItem
          checked={false}
          onCheckedChange={onCheckedChange}
          payload={payload}
          versionInfo={versionInfo}
        />,
      )

      expect(screen.getByTestId('plugin-card')).toHaveAttribute('data-icon', 'https://icons.example/icon.png')
      expect(screen.getByTestId('version-badge')).toHaveTextContent('1.0.0')

      fireEvent.click(screen.getByRole('checkbox'))
      expect(onCheckedChange).toHaveBeenCalledWith(payload)
    })

    it('should use marketplace icon urls and disable selection when install is restricted', () => {
      mockCanInstall = false
      const payload = createPlugin({
        org: 'market-org',
        name: 'market-plugin',
      })

      render(
        <LoadedItem
          checked
          isFromMarketPlace
          onCheckedChange={vi.fn()}
          payload={payload}
          versionInfo={versionInfo}
        />,
      )

      expect(screen.getByTestId('plugin-card')).toHaveAttribute(
        'data-icon',
        `${MARKETPLACE_API_PREFIX}/plugins/market-org/market-plugin/icon`,
      )
      expect(screen.getByTestId('plugin-card')).toHaveAttribute('data-limited-install', 'true')
      expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  // Covers the marketplace wrapper loading state and version override behavior.
  describe('MarketPlaceItem', () => {
    it('should render loading while the marketplace payload is unavailable', () => {
      render(
        <MarketPlaceItem
          checked={false}
          onCheckedChange={vi.fn()}
          payload={undefined}
          version="2.0.0"
          versionInfo={versionInfo}
        />,
      )

      expect(screen.getByText('loading')).toBeInTheDocument()
    })

    it('should pass the marketplace version into the loaded item payload', () => {
      const onCheckedChange = vi.fn()
      render(
        <MarketPlaceItem
          checked={false}
          onCheckedChange={onCheckedChange}
          payload={createPlugin({ version: '1.0.0' })}
          version="2.0.0"
          versionInfo={versionInfo}
        />,
      )

      expect(screen.getByTestId('version-badge')).toHaveTextContent('2.0.0')

      fireEvent.click(screen.getByRole('checkbox'))
      expect(onCheckedChange).toHaveBeenCalledWith(expect.objectContaining({
        version: '2.0.0',
      }))
    })
  })

  // Covers local package conversion and missing-manifest fallback.
  describe('PackageItem', () => {
    it('should render a loading error when the package manifest is missing', () => {
      render(
        <PackageItem
          checked={false}
          onCheckedChange={vi.fn()}
          payload={createPackageDependency({
            value: {
              unique_identifier: 'missing-manifest',
              manifest: undefined as unknown as PackageDependency['value']['manifest'],
            },
          })}
          versionInfo={versionInfo}
        />,
      )

      expect(screen.getByText('loading-error')).toBeInTheDocument()
    })

    it('should convert package manifests and forward the packaged plugin payload', () => {
      const onCheckedChange = vi.fn()
      render(
        <PackageItem
          checked={false}
          onCheckedChange={onCheckedChange}
          payload={createPackageDependency()}
          versionInfo={versionInfo}
        />,
      )

      expect(mockPluginManifestToCardPluginProps).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByRole('checkbox'))
      expect(onCheckedChange).toHaveBeenCalledWith(expect.objectContaining({
        plugin_id: 'manifest-plugin-id',
        from: 'package',
      }))
    })
  })

  // Covers GitHub dependency fetching success and failure flows.
  describe('GitHubItem', () => {
    it('should show loading until the GitHub package metadata arrives', () => {
      render(
        <GitHubItem
          checked={false}
          onCheckedChange={vi.fn()}
          dependency={{
            type: 'github',
            value: {
              repo: 'org/repo',
              version: '1.0.0',
              package: 'tool',
            },
          }}
          versionInfo={versionInfo}
          onFetchedPayload={vi.fn()}
          onFetchError={vi.fn()}
        />,
      )

      expect(screen.getByText('loading')).toBeInTheDocument()
    })

    it('should hydrate the loaded item and notify the parent after a successful fetch', async () => {
      const onFetchedPayload = vi.fn()
      const onCheckedChange = vi.fn()
      mockUseUploadGitHub.mockReturnValue({
        data: {
          manifest: { plugin_unique_identifier: 'fetched-plugin-id' },
          unique_identifier: 'github-uid',
        },
        error: undefined,
      } as unknown as ReturnType<typeof useUploadGitHub>)
      mockPluginManifestToCardPluginProps.mockReturnValue(createPlugin({
        plugin_id: 'fetched-plugin-id',
      }))

      render(
        <GitHubItem
          checked={false}
          onCheckedChange={onCheckedChange}
          dependency={{
            type: 'github',
            value: {
              repo: 'org/repo',
              release: '1.2.3',
              packages: 'tool',
            },
          }}
          versionInfo={versionInfo}
          onFetchedPayload={onFetchedPayload}
          onFetchError={vi.fn()}
        />,
      )

      await waitFor(() => expect(onFetchedPayload).toHaveBeenCalledWith(expect.objectContaining({
        plugin_id: 'github-uid',
      })))

      fireEvent.click(screen.getByRole('checkbox'))
      expect(onCheckedChange).toHaveBeenCalledWith(expect.objectContaining({
        plugin_id: 'github-uid',
        from: 'github',
      }))
    })

    it('should notify the parent when the GitHub fetch fails', async () => {
      const onFetchError = vi.fn()
      mockUseUploadGitHub.mockReturnValue({
        data: undefined,
        error: new Error('failed'),
      } as unknown as ReturnType<typeof useUploadGitHub>)

      render(
        <GitHubItem
          checked={false}
          onCheckedChange={vi.fn()}
          dependency={{
            type: 'github',
            value: {
              repo: 'org/repo',
              version: '1.0.0',
              package: 'tool',
            },
          }}
          versionInfo={versionInfo}
          onFetchedPayload={vi.fn()}
          onFetchError={onFetchError}
        />,
      )

      await waitFor(() => expect(onFetchError).toHaveBeenCalledTimes(1))
    })
  })
})
