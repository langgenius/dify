import type { FilterState } from '../index'
import { fireEvent, render, screen } from '@testing-library/react'
import FilterManagement from '../index'

let initialFilters: FilterState = {
  categories: [],
  tags: [],
  searchQuery: '',
}

vi.mock('../../context', () => ({
  usePluginPageContext: (selector: (state: { filters: FilterState }) => unknown) =>
    selector({ filters: initialFilters }),
}))

vi.mock('../../../hooks', () => ({
  useCategories: () => ({
    categories: [{ name: 'model', label: 'Models' }],
    categoriesMap: { model: { name: 'model', label: 'Models' } },
  }),
  useTags: () => ({
    tags: [{ name: 'agent', label: 'Agent' }],
    getTagLabel: (name: string) => ({ agent: 'Agent' })[name] ?? name,
  }),
}))

describe('FilterManagement', () => {
  beforeEach(() => {
    initialFilters = { categories: [], tags: [], searchQuery: '' }
  })

  it('renders filters from the plugin page state', () => {
    initialFilters = { categories: ['model'], tags: ['agent'], searchQuery: 'search' }

    render(<FilterManagement onFilterChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Models/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agent/ })).toBeInTheDocument()
    expect(screen.getByDisplayValue('search')).toBeInTheDocument()
  })

  it('emits the complete filter state when search changes', () => {
    const onFilterChange = vi.fn()
    initialFilters = { categories: ['model'], tags: ['agent'], searchQuery: '' }
    render(<FilterManagement onFilterChange={onFilterChange} />)

    fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
      target: { value: 'new query' },
    })

    expect(onFilterChange).toHaveBeenCalledWith({
      categories: ['model'],
      tags: ['agent'],
      searchQuery: 'new query',
    })
  })

  it('hides optional filters', () => {
    render(<FilterManagement hideCategoryFilter hideTagFilter onFilterChange={vi.fn()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('plugin.search')).toBeInTheDocument()
  })

  it('renders a right-side slot', () => {
    render(<FilterManagement onFilterChange={vi.fn()} rightSlot={<span>Sort controls</span>} />)

    expect(screen.getByText('Sort controls')).toBeInTheDocument()
  })
})
