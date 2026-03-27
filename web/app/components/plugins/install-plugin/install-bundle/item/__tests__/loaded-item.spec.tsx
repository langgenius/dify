import type { Plugin, VersionProps } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { MARKETPLACE_API_PREFIX } from '@/config'
import LoadedItem from '../loaded-item'

const mockGetIconUrl = vi.fn((icon: string) => `https://icons.example/${icon}`)
let mockCanInstall = true

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

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, titleLeft, limitedInstall }: { payload: Plugin, titleLeft?: React.ReactNode, limitedInstall?: boolean }) => (
    <div data-testid="plugin-card" data-icon={payload.icon} data-limited-install={String(!!limitedInstall)}>
      {titleLeft}
      <span>{payload.name}</span>
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
  from: 'github',
  ...overrides,
})

const versionInfo: VersionProps = {
  hasInstalled: false,
  toInstallVersion: '0.0.1',
}

describe('LoadedItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanInstall = true
  })

  // Covers local icon resolution and checkbox interaction.
  describe('local payloads', () => {
    it('should resolve local icons and emit the plugin when checked', () => {
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
      expect(screen.getAllByText('1.0.0').length).toBeGreaterThan(0)

      fireEvent.click(screen.getByRole('checkbox'))
      expect(onCheckedChange).toHaveBeenCalledWith(payload)
    })
  })

  // Covers marketplace icon resolution and install-limit behavior.
  describe('marketplace payloads', () => {
    it('should use marketplace icon URLs and disable selection when install is limited', () => {
      mockCanInstall = false

      render(
        <LoadedItem
          checked
          isFromMarketPlace
          onCheckedChange={vi.fn()}
          payload={createPlugin({
            org: 'market-org',
            name: 'market-plugin',
          })}
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
})
