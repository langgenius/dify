import type { IItem } from './index'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import Collapse from './index'

describe('Collapse', () => {
  const mockItems: IItem[] = [
    { key: '1', name: 'Item 1' },
    { key: '2', name: 'Item 2' },
  ]

  const mockRenderItem = (item: IItem) => (
    <div data-testid={`item-${item.key}`}>
      {item.name}
    </div>
  )

  const mockOnSelect = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should render title and initially closed state (ChevronRightIcon)', () => {
    const { container } = render(
      <Collapse
        title="Test Title"
        items={mockItems}
        renderItem={mockRenderItem}
      />,
    )

    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.queryByTestId('item-1')).not.toBeInTheDocument()
    // Verify an SVG is present (ChevronRightIcon)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should toggle content open and closed (ChevronDownIcon)', () => {
    const { container } = render(
      <Collapse
        title="Test Title"
        items={mockItems}
        renderItem={mockRenderItem}
      />,
    )

    // Initially closed
    expect(screen.queryByTestId('item-1')).not.toBeInTheDocument()

    // Click to open
    fireEvent.click(screen.getByText('Test Title'))
    expect(screen.getByTestId('item-1')).toBeInTheDocument()
    expect(screen.getByTestId('item-2')).toBeInTheDocument()

    // Verify SVG is present (ChevronDownIcon)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()

    // Click to close
    fireEvent.click(screen.getByText('Test Title'))
    expect(screen.queryByTestId('item-1')).not.toBeInTheDocument()
  })

  it('should handle item selection', () => {
    render(
      <Collapse
        title="Test Title"
        items={mockItems}
        renderItem={mockRenderItem}
        onSelect={mockOnSelect}
      />,
    )

    // Open first
    fireEvent.click(screen.getByText('Test Title'))

    // Select item 1
    const item1 = screen.getByTestId('item-1')
    // The click handler is on the parent div of the rendered item
    fireEvent.click(item1)

    expect(mockOnSelect).toHaveBeenCalledTimes(1)
    expect(mockOnSelect).toHaveBeenCalledWith(mockItems[0])
  })

  it('should not crash when onSelect is undefined and item is clicked', () => {
    render(
      <Collapse
        title="Test Title"
        items={mockItems}
        renderItem={mockRenderItem}
        // onSelect is undefined
      />,
    )

    // Open
    fireEvent.click(screen.getByText('Test Title'))

    // Click item
    const item1 = screen.getByTestId('item-1')
    fireEvent.click(item1)

    // Should not throw and nothing happens
  })

  it('should apply custom wrapperClassName', () => {
    const { container } = render(
      <Collapse
        title="Test Title"
        items={[]}
        renderItem={mockRenderItem}
        wrapperClassName="custom-class"
      />,
    )

    expect(container.firstChild).toHaveClass('custom-class')
  })
})
