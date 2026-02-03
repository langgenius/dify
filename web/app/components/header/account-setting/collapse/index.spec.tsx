import type { IItem } from './index'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import Collapse from './index'

vi.mock('@heroicons/react/24/outline', () => ({
  ChevronDownIcon: () => <span data-testid="chevron-down">Down</span>,
  ChevronRightIcon: () => <span data-testid="chevron-right">Right</span>,
}))

describe('Collapse', () => {
  const mockItems: IItem[] = [
    { key: '1', name: 'Item 1' },
    { key: '2', name: 'Item 2' },
  ]
  const mockRenderItem = vi.fn(item => (
    <div data-testid={`item-${item.key}`}>
      {item.name}
      {' '}
      Content
    </div>
  ))
  const mockOnSelect = vi.fn()

  it('renders title', () => {
    render(<Collapse title="Test Title" items={[]} renderItem={mockRenderItem} />)
    expect(screen.getByText('Test Title')).toBeInTheDocument()
  })

  it('toggles content', () => {
    render(<Collapse title="Test Title" items={mockItems} renderItem={mockRenderItem} />)
    expect(screen.queryByTestId('item-1')).not.toBeInTheDocument() // Initially closed

    fireEvent.click(screen.getByText('Test Title'))
    expect(screen.getByTestId('item-1')).toBeInTheDocument() // Open

    fireEvent.click(screen.getByText('Test Title'))
    expect(screen.queryByTestId('item-1')).not.toBeInTheDocument() // Closed again
  })

  it('handles selection', () => {
    render(<Collapse title="Test Title" items={mockItems} renderItem={mockRenderItem} onSelect={mockOnSelect} />)
    fireEvent.click(screen.getByText('Test Title')) // Open
    fireEvent.click(screen.getByTestId('item-1').parentElement!) // Click item wrapper
    expect(mockOnSelect).toHaveBeenCalledWith(mockItems[0])
  })
})
