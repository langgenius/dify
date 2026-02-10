import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiArrowDownSLine: () => <span data-testid="icon-arrow-down" />,
  RiCloseCircleFill: ({ onClick }: { onClick?: (e: React.MouseEvent) => void }) => (
    <span data-testid="icon-clear" onClick={onClick} />
  ),
}))

vi.mock('@/app/components/base/checkbox', () => ({
  default: ({ checked }: { checked: boolean }) => (
    <input type="checkbox" data-testid="checkbox" checked={checked} readOnly />
  ),
}))

vi.mock('@/app/components/base/input', () => ({
  default: ({ value, onChange, placeholder }: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder: string
    [key: string]: unknown
  }) => (
    <input data-testid="search-input" value={value} onChange={onChange} placeholder={placeholder} />
  ),
}))

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

vi.mock('../../hooks', () => ({
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
  let CategoriesFilter: (typeof import('./category-filter'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./category-filter')
    CategoriesFilter = mod.default
  })

  it('should show "allCategories" when no categories selected', () => {
    render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

    expect(screen.getByText('allCategories')).toBeInTheDocument()
  })

  it('should show selected category labels', () => {
    render(<CategoriesFilter value={['tool']} onChange={vi.fn()} />)

    // "Tool" appears both in trigger and dropdown list
    const toolElements = screen.getAllByText('Tool')
    expect(toolElements.length).toBeGreaterThanOrEqual(1)
  })

  it('should show +N when more than 2 selected', () => {
    render(<CategoriesFilter value={['tool', 'model', 'extension']} onChange={vi.fn()} />)

    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('should show clear button when categories are selected', () => {
    render(<CategoriesFilter value={['tool']} onChange={vi.fn()} />)

    expect(screen.getByTestId('icon-clear')).toBeInTheDocument()
  })

  it('should clear all selections when clear button clicked', () => {
    const mockOnChange = vi.fn()
    render(<CategoriesFilter value={['tool']} onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId('icon-clear'))
    expect(mockOnChange).toHaveBeenCalledWith([])
  })

  it('should show arrow down when no selection', () => {
    render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

    expect(screen.getByTestId('icon-arrow-down')).toBeInTheDocument()
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

    // Click on the option in dropdown (last "Tool" element)
    const toolElements = screen.getAllByText('Tool')
    fireEvent.click(toolElements[toolElements.length - 1])
    expect(mockOnChange).toHaveBeenCalledWith([])
  })
})
