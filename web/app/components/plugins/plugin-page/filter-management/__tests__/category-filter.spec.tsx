import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => (
    <div data-testid="portal" data-open={open}>{children}</div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="portal-content">{children}</div>
  ),
}))

vi.mock('@/utils/classnames', () => ({
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

    expect(screen.getByText('plugin.allCategories')).toBeInTheDocument()
  })

  it('should show selected category labels', () => {
    render(<CategoriesFilter value={['tool']} onChange={vi.fn()} />)

    const toolElements = screen.getAllByText('Tool')
    expect(toolElements.length).toBeGreaterThanOrEqual(1)
  })

  it('should show +N when more than 2 selected', () => {
    render(<CategoriesFilter value={['tool', 'model', 'extension']} onChange={vi.fn()} />)

    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('should clear all selections when clear button clicked', () => {
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={['tool']} onChange={mockOnChange} />)

    const trigger = screen.getByTestId('portal-trigger')
    const clearSvg = trigger.querySelector('svg')
    fireEvent.click(clearSvg!)
    expect(mockOnChange).toHaveBeenCalledWith([])
  })

  it('should render category options in dropdown', () => {
    render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

    expect(screen.getByText('Tool')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Extension')).toBeInTheDocument()
  })

  it('should toggle category on option click', () => {
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={[]} onChange={mockOnChange} />)

    fireEvent.click(screen.getByText('Tool'))
    expect(mockOnChange).toHaveBeenCalledWith(['tool'])
  })

  it('should remove category when clicking already selected', () => {
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={['tool']} onChange={mockOnChange} />)

    const toolElements = screen.getAllByText('Tool')
    fireEvent.click(toolElements[toolElements.length - 1])
    expect(mockOnChange).toHaveBeenCalledWith([])
  })
})
