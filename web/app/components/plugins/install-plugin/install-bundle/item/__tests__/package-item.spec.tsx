import type { PackageDependency, Plugin, VersionProps } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import PackageItem from '../package-item'

const mockPluginManifestToCardPluginProps = vi.fn()

vi.mock('@/app/components/plugins/install-plugin/base/loading-error', () => ({
  default: () => <div>loading-error</div>,
}))

vi.mock('@/app/components/plugins/install-plugin/utils', () => ({
  pluginManifestToCardPluginProps: (...args: unknown[]) => mockPluginManifestToCardPluginProps(...args),
}))

vi.mock('../loaded-item', () => ({
  default: ({ payload, isFromMarketPlace }: { payload: Plugin, isFromMarketPlace?: boolean }) => (
    <div data-testid="loaded-item" data-plugin-id={payload.plugin_id} data-from={payload.from} data-marketplace={String(!!isFromMarketPlace)}>
      {payload.name}
    </div>
  ),
}))

const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'tool',
  org: 'plugin-org',
  name: 'Plugin Name',
  plugin_id: 'plugin-id',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'pkg-id',
  icon: 'icon.png',
  verified: false,
  label: { 'en-US': 'Plugin Name' } as Plugin['label'],
  brief: { 'en-US': 'Plugin brief' } as Plugin['brief'],
  description: { 'en-US': 'Plugin description' } as Plugin['description'],
  introduction: '',
  repository: '',
  category: 'tool' as Plugin['category'],
  install_count: 0,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'langgenius' },
  from: 'package',
  ...overrides,
})

const createPackageDependency = (overrides: Partial<PackageDependency> = {}): PackageDependency => ({
  type: 'package',
  value: {
    unique_identifier: 'package-plugin-uid',
    manifest: {
      plugin_unique_identifier: 'package-plugin-uid',
    } as PackageDependency['value']['manifest'],
  },
  ...overrides,
})

const versionInfo: VersionProps = {
  hasInstalled: false,
  toInstallVersion: '0.0.1',
}

describe('PackageItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPluginManifestToCardPluginProps.mockReturnValue(createPlugin())
  })

  // Covers the missing-manifest fallback.
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

  // Covers manifest transformation and prop forwarding into LoadedItem.
  it('should transform the package manifest and forward marketplace origin when requested', () => {
    render(
      <PackageItem
        checked
        onCheckedChange={vi.fn()}
        payload={createPackageDependency()}
        isFromMarketPlace
        versionInfo={versionInfo}
      />,
    )

    expect(mockPluginManifestToCardPluginProps).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('loaded-item')).toHaveAttribute('data-plugin-id', 'plugin-id')
    expect(screen.getByTestId('loaded-item')).toHaveAttribute('data-from', 'package')
    expect(screen.getByTestId('loaded-item')).toHaveAttribute('data-marketplace', 'true')
  })
})
