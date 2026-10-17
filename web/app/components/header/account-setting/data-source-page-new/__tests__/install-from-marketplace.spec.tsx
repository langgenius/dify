import type { DatasourceProviderAuthResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { Plugin } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTheme } from 'next-themes'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useMarketplaceAllPlugins } from '../hooks'
import InstallFromMarketplace from '../install-from-marketplace'

vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

// Mock marketplace components

vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: ({
    plugins,
    cardRender,
    cardContainerClassName,
    emptyClassName,
  }: {
    plugins: Plugin[]
    cardRender: (p: Plugin) => React.ReactNode
    cardContainerClassName?: string
    emptyClassName?: string
  }) => (
    <div data-testid="mock-list" className={cardContainerClassName}>
      {plugins.length === 0 && <div className={emptyClassName} aria-label="empty-state" />}
      {plugins.map((plugin) => (
        <div key={plugin.plugin_id} data-testid={`list-item-${plugin.plugin_id}`}>
          {cardRender(plugin)}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/provider-card', () => ({
  default: ({ className, payload }: { className?: string; payload: Plugin }) => (
    <div data-testid={`mock-provider-card-${payload.plugin_id}`} className={className}>
      {payload.name}
    </div>
  ),
}))

vi.mock('../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks')>()),
  useMarketplaceAllPlugins: vi.fn(),
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  usePluginSettingsAccess: () => ({
    canInstallPlugin: true,
  }),
}))

describe('InstallFromMarketplace Component', () => {
  const mockProviders: DatasourceProviderAuthResponse[] = [
    {
      author: 'Author',
      provider: 'provider',
      plugin_id: 'p1',
      plugin_unique_identifier: 'u1',
      icon: 'icon',
      name: 'name',
      label: { en_US: 'Label', zh_Hans: '标签' },
      description: { en_US: 'Desc', zh_Hans: '描述' },
      credential_schema: [],
      oauth_schema: null,
      credentials_list: [],
    },
  ]

  const mockPlugins: Plugin[] = [
    {
      type: 'plugin',
      plugin_id: 'plugin-1',
      name: 'Plugin 1',
      category: PluginCategoryEnum.datasource,
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
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({ plugins: [], isLoading: false })
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      setTheme: vi.fn(),
      themes: ['light', 'dark'],
      systemTheme: 'light',
      resolvedTheme: 'light',
    } as unknown as ReturnType<typeof useTheme>)
  })

  describe('Rendering', () => {
    it('announces the number of recommended integrations after a search finishes', () => {
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: mockPlugins,
        isLoading: false,
      })

      render(<InstallFromMarketplace providers={mockProviders} searchText="plugin" />)

      expect(screen.getByRole('status')).toHaveTextContent(
        'modelProvider.modelProvider.installDataSource: plugin.marketplace.pluginsResult:{"num":1}',
      )
    })

    it('should render correctly when not loading and not collapsed', () => {
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: mockPlugins,
        isLoading: false,
      })
      render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
      expect(screen.getByText('modelProvider.modelProvider.installDataSource')).toBeInTheDocument()
      expect(screen.getByText('modelProvider.modelProvider.discoverMore')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: 'plugin.marketplace.difyMarketplace' })
      const url = new URL(link.getAttribute('href')!, window.location.href)
      expect(url.pathname).toBe('/plugins/datasource')
      expect(url.searchParams.get('theme')).toBe('light')
      expect(screen.getByTestId('mock-list')).toBeInTheDocument()
      expect(screen.getByText('Plugin 1')).toBeInTheDocument()
      expect(screen.queryByTestId('mock-provider-card-bundle-1')).not.toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should toggle collapse state when clicking the header', async () => {
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: mockPlugins,
        isLoading: false,
      })
      render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
      const toggleHeader = screen.getByText('modelProvider.modelProvider.installDataSource')
      await userEvent.setup().click(toggleHeader)
      expect(screen.queryByTestId('mock-list')).not.toBeInTheDocument()
      await userEvent.setup().click(toggleHeader)
      expect(screen.getByTestId('mock-list')).toBeInTheDocument()
    })

    it('should not show loading state even if isLoading is true when component is collapsed', async () => {
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: [],
        isLoading: true,
      })
      render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
      const toggleHeader = screen.getByText('modelProvider.modelProvider.installDataSource')
      await userEvent.setup().click(toggleHeader)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('should use the marketplace callback action when provided', async () => {
      vi.mocked(useMarketplaceAllPlugins).mockReturnValue({
        plugins: mockPlugins,
        isLoading: false,
      })
      const onOpenMarketplace = vi.fn()
      render(
        <InstallFromMarketplace
          providers={mockProviders}
          searchText=""
          onOpenMarketplace={onOpenMarketplace}
        />,
      )
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'plugin.marketplace.difyMarketplace' }))
      expect(onOpenMarketplace).toHaveBeenCalledTimes(1)
      expect(
        screen.queryByRole('link', { name: 'plugin.marketplace.difyMarketplace' }),
      ).not.toBeInTheDocument()
    })
  })
})
