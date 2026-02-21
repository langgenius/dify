import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MenuBar from '../menu-bar'

vi.mock('../../display-toggle', () => ({
  default: ({ isCollapsed, toggleCollapsed }: { isCollapsed: boolean, toggleCollapsed: () => void }) => (
    <button data-testid="display-toggle" onClick={toggleCollapsed}>
      {isCollapsed ? 'collapsed' : 'expanded'}
    </button>
  ),
}))

vi.mock('../../status-item', () => ({
  default: ({ item }: { item: { name: string } }) => <div data-testid="status-item">{item.name}</div>,
}))

describe('MenuBar', () => {
  const defaultProps = {
    isAllSelected: false,
    isSomeSelected: false,
    onSelectedAll: vi.fn(),
    isLoading: false,
    totalText: '10 Chunks',
    statusList: [
      { value: 'all', name: 'All' },
      { value: 0, name: 'Enabled' },
      { value: 1, name: 'Disabled' },
    ],
    selectDefaultValue: 'all' as const,
    onChangeStatus: vi.fn(),
    inputValue: '',
    onInputChange: vi.fn(),
    isCollapsed: false,
    toggleCollapsed: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render total text', () => {
    render(<MenuBar {...defaultProps} />)
    expect(screen.getByText('10 Chunks')).toBeInTheDocument()
  })

  it('should render checkbox', () => {
    const { container } = render(<MenuBar {...defaultProps} />)
    const checkbox = container.querySelector('[class*="shrink-0"]')
    expect(checkbox).toBeInTheDocument()
  })

  it('should call onInputChange when input changes', () => {
    render(<MenuBar {...defaultProps} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'test search' } })
    expect(defaultProps.onInputChange).toHaveBeenCalledWith('test search')
  })

  it('should render display toggle', () => {
    render(<MenuBar {...defaultProps} />)
    expect(screen.getByTestId('display-toggle')).toBeInTheDocument()
  })

  it('should call toggleCollapsed when display toggle clicked', () => {
    render(<MenuBar {...defaultProps} />)
    fireEvent.click(screen.getByTestId('display-toggle'))
    expect(defaultProps.toggleCollapsed).toHaveBeenCalled()
  })

  it('should call onInputChange with empty string when input is cleared', () => {
    render(<MenuBar {...defaultProps} inputValue="some text" />)
    const clearButton = screen.getByTestId('input-clear')
    fireEvent.click(clearButton)
    expect(defaultProps.onInputChange).toHaveBeenCalledWith('')
  })

  it('should render select with status items via renderOption', () => {
    render(<MenuBar {...defaultProps} />)
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('should call renderOption for each item when dropdown is opened', async () => {
    render(<MenuBar {...defaultProps} />)

    const selectButton = screen.getByRole('button', { name: /All/i })
    fireEvent.click(selectButton)

    // After opening, renderOption is called for each item, rendering the mocked StatusItem
    const statusItems = await screen.findAllByTestId('status-item')
    expect(statusItems.length).toBe(3)
    expect(statusItems[0]).toHaveTextContent('All')
    expect(statusItems[1]).toHaveTextContent('Enabled')
    expect(statusItems[2]).toHaveTextContent('Disabled')
  })
})
