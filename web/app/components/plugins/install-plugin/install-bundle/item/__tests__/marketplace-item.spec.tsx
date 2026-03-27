import type { Plugin, VersionProps } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import MarketPlaceItem from '../marketplace-item'

vi.mock('@/app/components/plugins/install-plugin/base/loading', () => ({
  default: () => <div>loading</div>,
}))

vi.mock('../loaded-item', () => ({
  default: ({ payload, isFromMarketPlace }: { payload: Plugin, isFromMarketPlace?: boolean }) => (
    <div data-testid="loaded-item" data-version={payload.version} data-marketplace={String(!!isFromMarketPlace)}>
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
  from: 'marketplace',
  ...overrides,
})

const versionInfo: VersionProps = {
  hasInstalled: false,
  toInstallVersion: '0.0.1',
}

describe('MarketPlaceItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers the loading placeholder when payload metadata has not arrived.
  it('should render loading when the marketplace payload is missing', () => {
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

  // Covers payload version override and marketplace forwarding.
  it('should forward the marketplace payload with the requested version', () => {
    render(
      <MarketPlaceItem
        checked={false}
        onCheckedChange={vi.fn()}
        payload={createPlugin({ version: '1.0.0' })}
        version="2.0.0"
        versionInfo={versionInfo}
      />,
    )

    expect(screen.getByTestId('loaded-item')).toHaveAttribute('data-version', '2.0.0')
    expect(screen.getByTestId('loaded-item')).toHaveAttribute('data-marketplace', 'true')
  })
})
