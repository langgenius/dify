import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useMarketplaceAllPlugins } from './hooks'
import InstallFromMarketplace from './install-from-marketplace'

// Mock dependencies
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: ({ plugins, cardRender }: { plugins: Plugin[], cardRender: (plugin: Plugin) => React.ReactNode }) => (
    <div data-testid="marketplace-list">
      {plugins.map(p => (
        <div key={p.plugin_id} data-testid={`plugin-wrapper-${p.plugin_id}`}>
          {cardRender ? cardRender(p) : p.name}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/provider-card', () => ({
  default: ({ payload }: { payload: Plugin }) => <div data-testid={`provider-card-${payload.plugin_id}`}>{payload.name}</div>,
}))

vi.mock('./hooks', () => ({
  useMarketplaceAllPlugins: vi.fn(),
}))

vi.mock('@remixicon/react', () => ({
  RiArrowDownSLine: () => <span>DownIcon</span>,
  RiArrowRightUpLine: () => <span>ExternalLinkIcon</span>,
}))

describe('InstallFromMarketplace', () => {
  const mockProviders = [] as { plugin_id: string }[]
  const mockSearchText = ''

  // Helper to create mock plugins with necessary fields
  const createMockPlugin = (overrides: Partial<Plugin> = {}): Plugin => {
    return {
      plugin_id: 'default-id',
      name: 'Default Plugin',
      type: 'plugin',
      ...overrides,
    } as unknown as Plugin
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins: [],
      isLoading: false,
    })
  })

  it('renders correctly initially (not collapsed, not loading)', () => {
    const plugins = [createMockPlugin({ plugin_id: 'p1', name: 'Plugin 1', type: 'plugin' })]
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins,
      isLoading: false,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText={mockSearchText} />)

    expect(screen.getByText('modelProvider.installDataSourceProvider')).toBeInTheDocument()
    expect(screen.getByText('modelProvider.discoverMore')).toBeInTheDocument()
    expect(screen.getByText('marketplace.difyMarketplace')).toBeInTheDocument()
    expect(screen.getByTestId('marketplace-list')).toBeInTheDocument()
    // Check for provider-card because List mock now uses cardRender which uses ProviderCard
    expect(screen.getByTestId('provider-card-p1')).toBeInTheDocument()
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
  })

  it('shows loading state', () => {
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins: [],
      isLoading: true,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText={mockSearchText} />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.queryByTestId('marketplace-list')).not.toBeInTheDocument()
  })

  it('toggles collapse state', () => {
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins: [createMockPlugin({ plugin_id: 'p1', name: 'Plugin 1', type: 'plugin' })],
      isLoading: false,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText={mockSearchText} />)

    // Initially visible
    expect(screen.getByTestId('marketplace-list')).toBeInTheDocument()

    // Click to collapse
    const toggleButton = screen.getByText('modelProvider.installDataSourceProvider')
    fireEvent.click(toggleButton)

    // Should be hidden
    expect(screen.queryByTestId('marketplace-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(toggleButton)
    expect(screen.getByTestId('marketplace-list')).toBeInTheDocument()
  })

  it('renders nothing for bundle type plugins', () => {
    const plugins = [
      createMockPlugin({ plugin_id: 'p1', name: 'Plugin 1', type: 'plugin' }),
      createMockPlugin({ plugin_id: 'b1', name: 'Bundle 1', type: 'bundle' }),
    ]
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins,
      isLoading: false,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText={mockSearchText} />)

    expect(screen.getByTestId('provider-card-p1')).toBeInTheDocument()
    // The bundle plugin should be filtered out by cardRender
    expect(screen.queryByTestId('provider-card-b1')).not.toBeInTheDocument()
  })
})
