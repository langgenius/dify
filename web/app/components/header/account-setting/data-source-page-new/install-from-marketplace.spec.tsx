import type { DataSourceAuth } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useTheme } from 'next-themes'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useMarketplaceAllPlugins } from './hooks'
import InstallFromMarketplace from './install-from-marketplace'

/**
 * InstallFromMarketplace Component Tests
 * Using Unit approach to focus on the component's internal state and conditional rendering.
 */

// Mock external dependencies
vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => (
    <a href={href} data-testid="mock-link">{children}</a>
  ),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: vi.fn((path: string, { theme }: { theme: string }) => `https://marketplace.url${path}?theme=${theme}`),
}))

// Mock marketplace components

vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: ({ plugins, cardRender, cardContainerClassName, emptyClassName }: {
    plugins: Plugin[]
    cardRender: (p: Plugin) => React.ReactNode
    cardContainerClassName?: string
    emptyClassName?: string
  }) => (
    <div data-testid="mock-list" className={cardContainerClassName}>
      {plugins.length === 0 && <div className={emptyClassName} aria-label="empty-state" />}
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
      category: PluginCategoryEnum.datasource,
      // ...other minimal fields
    } as Plugin,
    {
      type: 'bundle',
      plugin_id: 'bundle-1',
      name: 'Bundle 1',
      category: PluginCategoryEnum.datasource,
    } as Plugin,
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      setTheme: vi.fn(),
      themes: ['light', 'dark'],
      systemTheme: 'light',
      resolvedTheme: 'light',
    } as unknown as ReturnType<typeof useTheme>)
  })

  describe('Rendering', () => {
    it('should render correctly when not loading and not collapsed', () => {
      // Arrange
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: mockPlugins,
        isLoading: false,
      })

      // Act
      render(<InstallFromMarketplace providers={mockProviders} searchText="" />)

      // Assert
      expect(screen.getByText('common.modelProvider.installDataSourceProvider')).toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.discoverMore')).toBeInTheDocument()
      expect(screen.getByTestId('mock-link')).toHaveAttribute('href', 'https://marketplace.url?theme=light')
      expect(screen.getByTestId('mock-list')).toBeInTheDocument()
      expect(screen.getByTestId('mock-provider-card-plugin-1')).toBeInTheDocument()
      expect(screen.queryByTestId('mock-provider-card-bundle-1')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('should show loading state when marketplace plugins are loading and component is not collapsed', () => {
      // Arrange
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: [],
        isLoading: true,
      })

      // Act
      render(<InstallFromMarketplace providers={mockProviders} searchText="" />)

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.queryByTestId('mock-list')).not.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should toggle collapse state when clicking the header', () => {
      // Arrange
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: mockPlugins,
        isLoading: false,
      })
      render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
      const toggleHeader = screen.getByText('common.modelProvider.installDataSourceProvider')

      // Act (Collapse)
      fireEvent.click(toggleHeader)
      // Assert
      expect(screen.queryByTestId('mock-list')).not.toBeInTheDocument()

      // Act (Expand)
      fireEvent.click(toggleHeader)
      // Assert
      expect(screen.getByTestId('mock-list')).toBeInTheDocument()
    })

    it('should not show loading state even if isLoading is true when component is collapsed', () => {
      // Arrange
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: [],
        isLoading: true,
      })
      render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
      const toggleHeader = screen.getByText('common.modelProvider.installDataSourceProvider')

      // Act (Collapse)
      fireEvent.click(toggleHeader)

      // Assert
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })
})
