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

vi.mock('@/app/components/workflow/block-selector/market-place-plugin/action', () => ({
  default: () => <button type="button" aria-label="common.operation.more" />,
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock(
  '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission',
  () => ({
    default: () => ({ canInstallPlugin: true, currentDifyVersion: '1.0.0' }),
  }),
)

vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  getMarketplaceUrl: (path = '') => `https://marketplace.test${path}`,
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

  it('reveals featured tools in batches and then returns to the initial list', async () => {
    const user = userEvent.setup()
    const plugins = Array.from({ length: 11 }, (_, index) =>
      createPlugin({
        plugin_id: `plugin-${index + 1}`,
        latest_package_identifier: `plugin-${index + 1}@1.0.0`,
        label: { en_US: `Plugin ${index + 1}`, zh_Hans: `Plugin ${index + 1}` },
      }),
    )
    const providers = plugins.map((plugin, index) =>
      createToolProvider({
        id: `provider-${index + 1}`,
        plugin_id: plugin.plugin_id,
        label: { en_US: `Provider ${index + 1}`, zh_Hans: `Provider ${index + 1}` },
      }),
    )
    const providerMap = new Map(providers.map((provider) => [provider.plugin_id!, provider]))

    render(<FeaturedTools plugins={plugins} providerMap={providerMap} onSelect={vi.fn()} />)

    expect(screen.getByText('Provider 1')).toBeInTheDocument()
    expect(screen.queryByText('Provider 6')).not.toBeInTheDocument()

    const showMoreButton = screen.getByRole('button', {
      name: 'workflow.tabs.showMoreFeatured',
    })
    expect(showMoreButton).not.toHaveAttribute('aria-expanded')

    await user.click(showMoreButton)

    expect(screen.getByText('Provider 10')).toBeInTheDocument()
    expect(screen.queryByText('Provider 11')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.tabs.showMoreFeatured' }))

    expect(screen.getByText('Provider 11')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.tabs.showLessFeatured' }))

    expect(screen.queryByText('Provider 6')).not.toBeInTheDocument()
  })

  it('restores the collapsed state and expands from the keyboard', async () => {
    const user = userEvent.setup()
    localStorage.setItem('workflow_tools_featured_collapsed', 'true')

    render(
      <FeaturedTools
        plugins={[createPlugin()]}
        providerMap={new Map([['plugin-1', createToolProvider()]])}
        onSelect={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'workflow.tabs.featuredTools' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Provider One')).not.toBeInTheDocument()

    trigger.focus()
    await user.keyboard('{Enter}')

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Provider One')).toBeInTheDocument()
    expect(globalThis.localStorage.getItem('workflow_tools_featured_collapsed')).toBe('false')
  })

  it('keeps the marketplace link and row actions keyboard reachable', async () => {
    const user = userEvent.setup()

    render(
      <FeaturedTools
        plugins={[createPlugin({ name: 'plugin-one' })]}
        providerMap={new Map()}
        onSelect={vi.fn()}
      />,
    )

    const detailsLink = screen.getByRole('link', { name: 'Plugin One' })
    const installButton = screen.getByRole('button', { name: 'plugin.installAction' })
    const moreButton = screen.getByRole('button', { name: 'common.operation.more' })

    expect(detailsLink).toHaveAttribute('href', 'https://marketplace.test/plugins/org/plugin-one')

    detailsLink.focus()
    await user.tab()
    expect(installButton).toHaveFocus()

    await user.tab()
    expect(moreButton).toHaveFocus()
  })

  it('shows the marketplace empty state when no featured tools are available', () => {
    render(<FeaturedTools plugins={[]} providerMap={new Map()} onSelect={vi.fn()} />)

    expect(screen.getByText('workflow.tabs.noFeaturedPlugins')).toBeInTheDocument()
  })
})
