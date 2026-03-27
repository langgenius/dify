import type { InstallStatus, Plugin } from '../../../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { MARKETPLACE_API_PREFIX } from '@/config'
import Installed from '../installed'

const mockGetIconUrl = vi.fn((icon: string) => `https://icons.example/${icon}`)

vi.mock('../../../base/use-get-icon', () => ({
  default: () => ({
    getIconUrl: mockGetIconUrl,
  }),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, installed, installFailed, titleLeft }: { payload: Plugin, installed?: boolean, installFailed?: boolean, titleLeft?: React.ReactNode }) => (
    <div
      data-testid="plugin-card"
      data-icon={payload.icon}
      data-installed={String(!!installed)}
      data-install-failed={String(!!installFailed)}
    >
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

describe('Installed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers marketplace/local icon resolution and status flags.
  describe('rendering', () => {
    it('should render installed cards with the correct icon source and status flags', () => {
      const list = [
        createPlugin({ from: 'marketplace', org: 'market-org', name: 'market-plugin' }),
        createPlugin({ plugin_id: 'plugin-2', name: 'Local Plugin', from: 'github' }),
      ]
      const installStatus: InstallStatus[] = [
        { success: true, isFromMarketPlace: true },
        { success: false, isFromMarketPlace: false },
      ]

      render(
        <Installed
          list={list}
          installStatus={installStatus}
          onCancel={vi.fn()}
        />,
      )

      const cards = screen.getAllByTestId('plugin-card')
      expect(cards[0]).toHaveAttribute('data-icon', `${MARKETPLACE_API_PREFIX}/plugins/market-org/market-plugin/icon`)
      expect(cards[0]).toHaveAttribute('data-installed', 'true')
      expect(cards[1]).toHaveAttribute('data-icon', 'https://icons.example/icon.png')
      expect(cards[1]).toHaveAttribute('data-install-failed', 'true')
      expect(screen.getAllByText('1.0.0').length).toBeGreaterThan(0)
    })
  })

  // Covers footer button visibility and close behavior.
  describe('actions', () => {
    it('should call onCancel when clicking close', () => {
      const onCancel = vi.fn()

      render(
        <Installed
          list={[createPlugin()]}
          installStatus={[{ success: true, isFromMarketPlace: false }]}
          onCancel={onCancel}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should hide the footer button when isHideButton is true', () => {
      render(
        <Installed
          list={[createPlugin()]}
          installStatus={[{ success: true, isFromMarketPlace: false }]}
          onCancel={vi.fn()}
          isHideButton
        />,
      )

      expect(screen.queryByRole('button', { name: 'common.operation.close' })).not.toBeInTheDocument()
    })
  })
})
