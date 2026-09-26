import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@langgenius/dify-ui/cn', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

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

  it('should show "allCategories" when no categories selected', () => {
    render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

    expect(screen.getByText('plugin.allCategories'))!.toBeInTheDocument()
  })

  it('should show selected category labels', () => {
    render(<CategoriesFilter value={['tool']} onChange={vi.fn()} />)

    const toolElements = screen.getAllByText('Tool')
    expect(toolElements.length).toBeGreaterThanOrEqual(1)
  })

  it('should show +N when more than 2 selected', () => {
    render(<CategoriesFilter value={['tool', 'model', 'extension']} onChange={vi.fn()} />)

    expect(screen.getByText('+1'))!.toBeInTheDocument()
  })

  it('should clear all selections when clear button clicked', () => {
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={['tool']} onChange={mockOnChange} />)

    const trigger = screen.getByRole('button', { name: /Tool/ })
    const clearSvg = trigger.querySelector('svg')
    fireEvent.click(clearSvg!)
    expect(mockOnChange).toHaveBeenCalledWith([])
  })

  it('should render category options in dropdown', () => {
    render(<CategoriesFilter value={[]} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'plugin.allCategories' }))

    expect(screen.getByText('Tool'))!.toBeInTheDocument()
    expect(screen.getByText('Model'))!.toBeInTheDocument()
    expect(screen.getByText('Extension'))!.toBeInTheDocument()
  })

  it('should toggle category on option click', () => {
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={[]} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'plugin.allCategories' }))
    fireEvent.click(screen.getByText('Tool'))
    expect(mockOnChange).toHaveBeenCalledWith(['tool'])
  })

  it('should remove category when clicking already selected', () => {
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={['tool']} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Tool/ }))
    const toolElements = screen.getAllByText('Tool')
    fireEvent.click(toolElements[toolElements.length - 1]!)
    expect(mockOnChange).toHaveBeenCalledWith([])
  })

  it('should filter categories by search text', async () => {
    const user = userEvent.setup()
    render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'plugin.allCategories' }))
    await user.type(screen.getByRole('searchbox', { name: 'plugin.searchCategories' }), 'mod')

    expect(screen.queryByText('Tool')).not.toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.queryByText('Extension')).not.toBeInTheDocument()
  })
})
