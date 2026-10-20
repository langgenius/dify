import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mockCategories = [
  { name: 'tool', label: 'Tool' },
  { name: 'model', label: 'Model' },
  { name: 'extension', label: 'Extension' },
]

vi.mock('../../../hooks', () => ({
  useCategories: () => ({
    categories: mockCategories,
    categoriesMap: {
      tool: { label: 'Tool' },
      model: { label: 'Model' },
      extension: { label: 'Extension' },
    },
  }),
}))

describe('CategoriesFilter', () => {
  let CategoriesFilter: (typeof import('../category-filter'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../category-filter')
    CategoriesFilter = mod.default
  })

  it('should show +N when more than 2 selected', () => {
    render(<CategoriesFilter value={['tool', 'model', 'extension']} onChange={vi.fn()} />)

    expect(screen.getByText('+1'))!.toBeInTheDocument()
  })

  it('clears categories through a separate keyboard control and restores focus', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [categories, setCategories] = React.useState(['tool'])
      return <CategoriesFilter value={categories} onChange={setCategories} />
    }

    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Tool' })
    const clearButton = screen.getByRole('button', {
      name: 'plugin.clearSearch:{"label":"plugin.allCategories"}',
    })
    expect(trigger).not.toContainElement(clearButton)

    await user.tab()
    expect(trigger).toHaveFocus()
    await user.tab()
    expect(clearButton).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(clearButton).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin.allCategories' })).toHaveFocus()
  })

  it('should toggle category on option click', async () => {
    const user = userEvent.setup()
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={[]} onChange={mockOnChange} />)

    await user.click(screen.getByRole('button', { name: 'plugin.allCategories' }))
    await user.click(screen.getByText('Tool'))
    expect(mockOnChange).toHaveBeenCalledWith(['tool'])
  })

  it('should remove category when clicking already selected', async () => {
    const user = userEvent.setup()
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={['tool']} onChange={mockOnChange} />)

    await user.click(screen.getByRole('button', { name: /Tool/ }))
    await user.click(within(await screen.findByRole('dialog')).getByText('Tool'))
    expect(mockOnChange).toHaveBeenCalledWith([])
  })

  it('should filter categories by search text', async () => {
    const user = userEvent.setup()
    render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'plugin.allCategories' }))
    expect(within(await screen.findByRole('dialog')).getByText('Tool')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('Extension')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'plugin.searchCategories' }), 'mod')

    expect(screen.queryByText('Tool')).not.toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.queryByText('Extension')).not.toBeInTheDocument()
  })
})
