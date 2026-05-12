import { fireEvent, screen } from '@testing-library/react'
import { renderWithNuqs } from '@/test/nuqs-testing'
import IntegrationsPage from '../integrations-page'

vi.mock('@/app/components/header/account-setting/model-provider-page', () => ({
  __esModule: true,
  default: ({
    onSearchTextChange,
    searchText,
  }: {
    onSearchTextChange?: (value: string) => void
    searchText: string
  }) => (
    <div data-testid="model-provider-page">
      <input
        aria-label="search"
        value={searchText}
        onChange={event => onSearchTextChange?.(event.target.value)}
      />
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/data-source-page-new', () => ({
  __esModule: true,
  default: () => <div data-testid="data-source-page" />,
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page', () => ({
  __esModule: true,
  default: () => <div data-testid="api-extension-page" />,
}))

vi.mock('../provider-list', () => ({
  __esModule: true,
  default: ({ category }: { category?: string }) => <div data-testid="tool-provider-list">{category}</div>,
}))

vi.mock('../plugin-category-page', () => ({
  __esModule: true,
  default: ({ category }: { category: string }) => <div data-testid={`plugin-category-${category}`} />,
}))

const renderIntegrationsPage = (searchParams?: Record<string, string>, section?: React.ComponentProps<typeof IntegrationsPage>['section']) => {
  return renderWithNuqs(<IntegrationsPage section={section} />, { searchParams })
}

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to the model provider section when no query is provided', () => {
    renderIntegrationsPage()

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
    expect(screen.getAllByText('common.settings.provider')).toHaveLength(2)
  })

  it('renders the model provider section from the section query', () => {
    renderIntegrationsPage({ section: 'provider' })

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
    expect(screen.getAllByText('common.settings.provider')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'search' })).toBeInTheDocument()
  })

  it('renders plugin category sections from the section query', () => {
    const triggerView = renderIntegrationsPage({ section: 'trigger' })

    expect(screen.getByTestId('plugin-category-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-category-trigger').parentElement).toHaveClass('flex', 'flex-col', 'overflow-hidden')
    expect(screen.getByRole('link', { name: 'common.settings.trigger' })).toHaveAttribute('href', '/integrations/trigger')

    triggerView.unmount()
    const agentStrategyView = renderIntegrationsPage({ section: 'agent-strategy' })

    expect(screen.getByTestId('plugin-category-agent-strategy')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.settings.agentStrategy' })).toHaveAttribute('href', '/integrations/agent-strategy')

    agentStrategyView.unmount()
    renderIntegrationsPage({ section: 'extension' })

    expect(screen.getByTestId('plugin-category-extension')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.settings.extension' })).toHaveAttribute('href', '/integrations/extension')
  })

  it('renders migrated legacy setting sections', () => {
    const { unmount } = renderIntegrationsPage({ section: 'data-source' })

    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()

    unmount()
    renderIntegrationsPage({ section: 'api-based-extension' })

    expect(screen.getByTestId('api-extension-page')).toBeInTheDocument()
  })

  it('renders existing pages from route sections', () => {
    const modelProviderView = renderIntegrationsPage(undefined, 'provider')

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()

    modelProviderView.unmount()
    const mcpView = renderIntegrationsPage(undefined, 'mcp')

    expect(screen.getByTestId('tool-provider-list')).toHaveTextContent('mcp')
    expect(screen.getByTestId('tool-provider-list').parentElement).toHaveClass('flex', 'flex-col', 'overflow-hidden')

    mcpView.unmount()
    renderIntegrationsPage(undefined, 'data-source')

    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
  })

  it('keeps existing category-only tools URLs functional', () => {
    renderIntegrationsPage({ category: 'mcp' })

    expect(screen.getByTestId('tool-provider-list')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveClass('bg-state-base-active')
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveAttribute('href', '/integrations/tools/mcp')
  })

  it('collapses and expands the integrations sidebar', () => {
    renderIntegrationsPage({ section: 'provider' })

    fireEvent.click(screen.getByRole('button', { name: 'common.settings.collapse' }))

    expect(screen.queryByText('common.settings.integrations')).not.toBeInTheDocument()
    expect(screen.queryByText('common.settings.swaggerAPIAsTool')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.settings.trigger' })).toHaveAttribute('href', '/integrations/trigger')
    expect(screen.getByRole('button', { name: 'common.settings.expand' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.settings.expand' }))

    expect(screen.getByText('common.settings.integrations')).toBeInTheDocument()
    expect(screen.getByText('common.settings.swaggerAPIAsTool')).toBeInTheDocument()
  })
})
