import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import FeaturedTools from '../featured-tools'
import { createPlugin, createToolProvider } from './factories'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({
    allowed: true,
  }),
}))

vi.mock('@/utils/var', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  getMarketplaceUrl: () => 'https://marketplace.test/tools',
}))

const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)

describe('FeaturedTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  it('shows more featured tools when the list exceeds the initial quota', async () => {
    const user = userEvent.setup()
    const plugins = Array.from({ length: 6 }, (_, index) =>
      createPlugin({
        plugin_id: `plugin-${index + 1}`,
        latest_package_identifier: `plugin-${index + 1}@1.0.0`,
        label: { en_US: `Plugin ${index + 1}`, zh_Hans: `Plugin ${index + 1}` },
      }))
    const providers = plugins.map((plugin, index) =>
      createToolProvider({
        id: `provider-${index + 1}`,
        plugin_id: plugin.plugin_id,
        label: { en_US: `Provider ${index + 1}`, zh_Hans: `Provider ${index + 1}` },
      }),
    )
    const providerMap = new Map(providers.map(provider => [provider.plugin_id!, provider]))

    render(
      <FeaturedTools
        plugins={plugins}
        providerMap={providerMap}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('Provider 1')).toBeInTheDocument()
    expect(screen.queryByText('Provider 6')).not.toBeInTheDocument()

    await user.click(screen.getByText('workflow.tabs.showMoreFeatured'))

    expect(screen.getByText('Provider 6')).toBeInTheDocument()
  })

  it('honors the persisted collapsed state', () => {
    localStorage.setItem('workflow_tools_featured_collapsed', 'true')

    render(
      <FeaturedTools
        plugins={[createPlugin()]}
        providerMap={new Map([[
          'plugin-1',
          createToolProvider(),
        ]])}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.tabs.featuredTools')).toBeInTheDocument()
    expect(screen.queryByText('Provider One')).not.toBeInTheDocument()
  })

  it('shows the marketplace empty state when no featured tools are available', () => {
    render(
      <FeaturedTools
        plugins={[]}
        providerMap={new Map()}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.tabs.noFeaturedPlugins')).toBeInTheDocument()
  })
})
