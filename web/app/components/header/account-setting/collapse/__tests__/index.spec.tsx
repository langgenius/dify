import type { IItem } from '../index'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Collapse from '../index'

describe('Collapse', () => {
  const mockItems: IItem[] = [
    { key: '1', name: 'Item 1' },
    { key: '2', name: 'Item 2' },
  ]

  const mockRenderItem = (item: IItem) => <div>{item.name}</div>

  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toggles its items and reports the selected item', async () => {
    const user = userEvent.setup()
    render(
      <Collapse
        title="Test Title"
        items={mockItems}
        renderItem={mockRenderItem}
        onSelect={mockOnSelect}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Test Title' })
    expect(screen.queryByText('Item 1')).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(screen.getByText('Item 1'))
    expect(mockOnSelect).toHaveBeenCalledWith(mockItems[0])

    await user.click(trigger)
    expect(screen.queryByText('Item 1')).not.toBeInTheDocument()
  })
})
