import { fireEvent, render, screen } from '@testing-library/react'
import PrioritySelector from './priority-selector'

describe('PrioritySelector', () => {
  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render selector button', () => {
    render(<PrioritySelector value="system" onSelect={mockOnSelect} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should call onSelect when option clicked', () => {
    render(<PrioritySelector value="system" onSelect={mockOnSelect} />)
    fireEvent.click(screen.getByRole('button'))
    const option = screen.getByText('common.modelProvider.apiKey')
    fireEvent.click(option)
    expect(mockOnSelect).toHaveBeenCalled()
  })

  it('should display priority use header in popover', () => {
    render(<PrioritySelector value="custom" onSelect={mockOnSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('common.modelProvider.card.priorityUse')).toBeInTheDocument()
  })
})
