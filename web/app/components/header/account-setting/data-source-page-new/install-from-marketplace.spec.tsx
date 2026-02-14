import type { DataSourceAuth } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useTheme } from 'next-themes'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useMarketplaceAllPlugins } from './hooks'
import InstallFromMarketplace from './install-from-marketplace'

/**
 * Mocking third-party and local dependencies to achieve 100% test coverage.
 */

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => (
    <a href={href} data-testid="mock-link">{children}</a>
  ),
}))

// Mock local utilities and components
vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: vi.fn((path: string, { theme }: { theme: string }) => `https://marketplace.url${path}?theme=${theme}`),
}))

vi.mock('@/app/components/base/divider', () => ({
  default: ({ className }: { className: string }) => <div data-testid="mock-divider" className={className} />,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: ({ type }: { type: string }) => <div data-testid="mock-loading" data-type={type}>Loading...</div>,
}))

vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: ({ plugins, cardRender, cardContainerClassName, emptyClassName }: {
    plugins: Plugin[]
    cardRender: (p: Plugin) => React.ReactNode
    cardContainerClassName?: string
    emptyClassName?: string
  }) => (
    <div data-testid="mock-list" className={cardContainerClassName}>
      {plugins.length === 0 && <div className={emptyClassName} />}
      {plugins.map(plugin => (
        <div key={plugin.plugin_id} data-testid={`list-item-${plugin.plugin_id}`}>
          {cardRender(plugin)}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/provider-card', () => ({
  default: ({ payload }: { payload: Plugin }) => (
    <div data-testid={`mock-provider-card-${payload.plugin_id}`}>
      {payload.name}
    </div>
  ),
}))

vi.mock('./hooks', () => ({
  useMarketplaceAllPlugins: vi.fn(),
}))

describe('InstallFromMarketplace Component', () => {
  const mockProviders: DataSourceAuth[] = [
    {
      author: 'Author',
      provider: 'provider',
      plugin_id: 'p1',
      plugin_unique_identifier: 'u1',
      icon: 'icon',
      name: 'name',
      label: { en_US: 'Label', zh_Hans: '标签' },
      description: { en_US: 'Desc', zh_Hans: '描述' },
      credentials_list: [],
    },
  ]

  const mockPlugins: Plugin[] = [
    {
      type: 'plugin',
      plugin_id: 'plugin-1',
      name: 'Plugin 1',
      org: 'org1',
      version: '1.0.0',
      latest_version: '1.0.0',
      latest_package_identifier: 'pkg1',
      icon: 'icon1',
      verified: true,
      label: { en_US: 'Label 1' },
      brief: { en_US: 'Brief 1' },
      description: { en_US: 'Desc 1' },
      introduction: 'Intro 1',
      repository: 'repo1',
      category: PluginCategoryEnum.datasource,
      install_count: 100,
      endpoint: { settings: [] },
      tags: [],
      badges: [],
      verification: { authorized_category: 'langgenius' },
      from: 'marketplace',
    },
    {
      type: 'bundle',
      plugin_id: 'bundle-1',
      name: 'Bundle 1',
      org: 'org2',
      version: '1.0.0',
      latest_version: '1.0.0',
      latest_package_identifier: 'pkg2',
      icon: 'icon2',
      verified: true,
      label: { en_US: 'Bundle 1' },
      brief: { en_US: 'Brief 2' },
      description: { en_US: 'Desc 2' },
      introduction: 'Intro 2',
      repository: 'repo2',
      category: PluginCategoryEnum.datasource,
      install_count: 50,
      endpoint: { settings: [] },
      tags: [],
      badges: [],
      verification: { authorized_category: 'langgenius' },
      from: 'marketplace',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      setTheme: vi.fn(),
      themes: ['light', 'dark'],
      systemTheme: 'light',
      resolvedTheme: 'light',
    } as ReturnType<typeof useTheme>)
  })

  it('should render correctly when not loading and not collapsed', () => {
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins: mockPlugins,
      isLoading: false,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)

    // Check header elements
    expect(screen.getByText('common.modelProvider.installDataSourceProvider')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.discoverMore')).toBeInTheDocument()
    expect(screen.getByTestId('mock-link')).toHaveAttribute('href', 'https://marketplace.url?theme=light')

    // Check List and ProviderCard (only for non-bundle)
    expect(screen.getByTestId('mock-list')).toBeInTheDocument()
    expect(screen.getByTestId('mock-provider-card-plugin-1')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-provider-card-bundle-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mock-loading')).not.toBeInTheDocument()
  })

  it('should show loading state when isAllPluginsLoading is true', () => {
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins: [],
      isLoading: true,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)

    expect(screen.getByTestId('mock-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-list')).not.toBeInTheDocument()
  })

  it('should toggle collapse state when clicking the header', () => {
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins: mockPlugins,
      isLoading: false,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)

    const toggleHeader = screen.getByText('common.modelProvider.installDataSourceProvider')

    // Initial state: not collapsed
    expect(screen.getByTestId('mock-list')).toBeInTheDocument()

    // Click to collapse
    fireEvent.click(toggleHeader)
    expect(screen.queryByTestId('mock-list')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(toggleHeader)
    expect(screen.getByTestId('mock-list')).toBeInTheDocument()
  })

  it('should not show loading state if collapsed even if isLoading is true', () => {
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
      plugins: [],
      isLoading: true,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)

    const toggleHeader = screen.getByText('common.modelProvider.installDataSourceProvider')

    // Collapse it
    fireEvent.click(toggleHeader)
    expect(screen.queryByTestId('mock-loading')).not.toBeInTheDocument()
  })
})
