import { fireEvent, screen } from '@testing-library/react'
import { renderWithNuqs } from '@/test/nuqs-testing'
import IntegrationsPage from '../integrations-page'

vi.mock('@/app/components/header/account-setting/model-provider-page', () => ({
  __esModule: true,
  default: ({
    onSearchTextChange,
    searchText,
  }: {
    onSearchTextChange: (value: string) => void
    searchText: string
  }) => (
    <div data-testid="model-provider-page">
      <input
        aria-label="search"
        value={searchText}
        onChange={event => onSearchTextChange(event.target.value)}
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
  default: () => <div data-testid="tool-provider-list" />,
}))

const renderIntegrationsPage = (searchParams?: Record<string, string>) => {
  return renderWithNuqs(<IntegrationsPage />, { searchParams })
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

  it('renders migrated legacy setting sections', () => {
    const { unmount } = renderIntegrationsPage({ section: 'data-source' })

    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()

    unmount()
    renderIntegrationsPage({ section: 'api-based-extension' })

    expect(screen.getByTestId('api-extension-page')).toBeInTheDocument()
  })

  it('keeps existing category-only tools URLs functional', () => {
    renderIntegrationsPage({ category: 'mcp' })

    expect(screen.getByTestId('tool-provider-list')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveClass('bg-state-base-active')
  })

  it('collapses and expands the integrations sidebar', () => {
    renderIntegrationsPage({ section: 'provider' })

    fireEvent.click(screen.getByRole('button', { name: 'common.settings.collapse' }))

    expect(screen.queryByText('common.settings.integrations')).not.toBeInTheDocument()
    expect(screen.queryByText('common.settings.customTool')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByLabelText('common.settings.trigger')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.settings.expand' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.settings.expand' }))

    expect(screen.getByText('common.settings.integrations')).toBeInTheDocument()
    expect(screen.getByText('common.settings.customTool')).toBeInTheDocument()
  })
})
