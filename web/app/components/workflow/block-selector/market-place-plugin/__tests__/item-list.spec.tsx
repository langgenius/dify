import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { createPlugin } from '../../__tests__/factories'
import Item from '../item'
import List from '../list'

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({
    uniqueIdentifier,
    onClose,
    onSuccess,
  }: {
    uniqueIdentifier: string
    onClose: () => void
    onSuccess: () => void
  }) => (
    <div data-testid="install-from-marketplace">
      {uniqueIdentifier}
      <button type="button" onClick={onSuccess}>install-success</button>
      <button type="button" onClick={onClose}>install-close</button>
    </div>
  ),
}))

vi.mock('../action', () => ({
  default: ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => (
    <button type="button" onClick={() => onOpenChange(!open)}>
      marketplace-action
    </button>
  ),
}))

vi.mock('@/utils/var', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  getMarketplaceUrl: (path = '', params?: Record<string, unknown>) => {
    const searchParams = new URLSearchParams(params as Record<string, string>)
    const query = searchParams.toString()
    return `https://marketplace.test${path}${query ? `?${query}` : ''}`
  },
}))

describe('marketplace plugin selector components', () => {
  it('should render marketplace plugin metadata and open install modal', async () => {
    const user = userEvent.setup()

    render(
      <Item
        payload={createPlugin({
          org: 'LangGenius',
          latest_package_identifier: 'plugin-1@2.0.0',
          install_count: 1200,
          label: { en_US: 'Search Plugin', zh_Hans: 'Search Plugin' },
          brief: { en_US: 'Searches documents', zh_Hans: 'Searches documents' },
        })}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getByText('Search Plugin')).toBeInTheDocument()
    expect(screen.getByText('Searches documents')).toBeInTheDocument()
    expect(screen.getByText('LangGenius')).toBeInTheDocument()

    await user.click(screen.getByText('plugin.installAction'))

    expect(screen.getByTestId('install-from-marketplace')).toHaveTextContent('plugin-1@2.0.0')

    await user.click(screen.getByRole('button', { name: 'install-success' }))

    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })

  it('should render find-more footer for empty filters and marketplace results for filtered searches', () => {
    const wrapElemRef = { current: document.createElement('div') }
    const plugin = createPlugin({
      label: { en_US: 'Filtered Plugin', zh_Hans: 'Filtered Plugin' },
    })

    const { rerender } = render(
      <List
        wrapElemRef={wrapElemRef}
        list={[]}
        searchText=""
        tags={[]}
        category={PluginCategoryEnum.tool}
      />,
    )

    expect(screen.getByRole('link', { name: /plugin\.findMoreInMarketplace/i })).toHaveAttribute('href', 'https://marketplace.test/plugins/tool')

    rerender(
      <List
        wrapElemRef={wrapElemRef}
        list={[plugin]}
        searchText="filtered"
        tags={['rag']}
        category={PluginCategoryEnum.tool}
      />,
    )

    expect(screen.getByText('plugin.fromMarketplace')).toBeInTheDocument()
    expect(screen.getByText('Filtered Plugin')).toBeInTheDocument()
    const marketplaceSearchLinks = screen.getAllByRole('link', { name: /plugin\.searchInMarketplace/i })
    expect(marketplaceSearchLinks).toHaveLength(1)
    expect(marketplaceSearchLinks[0]).toHaveAttribute('href', expect.stringContaining('q=filtered'))
    expect(marketplaceSearchLinks[0]).toHaveAttribute('href', expect.stringContaining('/plugins/tool'))
  })

  it('should hide the marketplace footer when requested and no filters are active', () => {
    const { container } = render(
      <List
        wrapElemRef={{ current: document.createElement('div') }}
        list={[]}
        searchText=""
        tags={[]}
        hideFindMoreFooter
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
