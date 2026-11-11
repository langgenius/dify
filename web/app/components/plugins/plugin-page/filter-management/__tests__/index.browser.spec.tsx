import type { FilterState } from '../index'
import { useRef, useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { PluginPageContext } from '../../context'
import FilterManagement from '../index'

function FilterExample() {
  const [filters, setFilters] = useState<FilterState>({
    categories: ['model'],
    tags: ['agent'],
    searchQuery: 'test query',
  })
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component.
    <PluginPageContext.Provider
      value={{
        containerRef,
        selectedItem: undefined,
        setSelectedItem: () => {},
        filters,
        setFilters,
        activeTab: 'plugins',
        setActiveTab: () => {},
        options: [],
      }}
    >
      <FilterManagement onFilterChange={setFilters} />
      <output aria-label="Saved filters">{JSON.stringify(filters)}</output>
    </PluginPageContext.Provider>
  )
}

beforeEach(async () => {
  await page.viewport(1024, 768)
})

it('edits the seeded query while preserving categories and tags in the saved filters', async () => {
  await render(<FilterExample />)
  await expect.element(page.getByRole('button', { name: 'plugin.category.models' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'pluginTags.tags.agent' })).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'plugin.search' })
  await expect.element(search).toHaveValue('test query')
  await expect.element(search).toHaveAttribute('placeholder', 'plugin.search')
  await search.fill('new query')

  await expect.element(search).toHaveValue('new query')
  await expect
    .element(page.getByRole('status', { name: 'Saved filters' }))
    .toHaveTextContent(
      JSON.stringify({ categories: ['model'], tags: ['agent'], searchQuery: 'new query' }),
    )
})

it('leaves only the query control available when optional filters are hidden', async () => {
  await render(<FilterManagement hideCategoryFilter hideTagFilter onFilterChange={() => {}} />)
  await expect.element(page.getByRole('button')).not.toBeInTheDocument()
  await userEvent.tab()
  await expect.element(page.getByRole('searchbox', { name: 'plugin.search' })).toHaveFocus()
})

it('keeps the supplied right-side control reachable after the search field', async () => {
  await render(
    <FilterManagement
      hideCategoryFilter
      hideTagFilter
      onFilterChange={() => {}}
      rightSlot={<button type="button">Sort controls</button>}
    />,
  )
  await userEvent.tab()
  await expect.element(page.getByRole('searchbox', { name: 'plugin.search' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'Sort controls' })).toHaveFocus()
})
