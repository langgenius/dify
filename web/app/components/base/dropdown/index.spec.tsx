import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import Dropdown from './index'

describe('Dropdown Component', () => {
  const mockItems = [
    { value: 'option1', text: 'Option 1' },
    { value: 'option2', text: 'Option 2' },
  ]
  const mockSecondItems = [
    { value: 'option3', text: 'Option 3' },
  ]
  const onSelect = vi.fn()

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders default trigger properly', () => {
    const { container } = render(
      <Dropdown items={mockItems} onSelect={onSelect} />,
    )
    const trigger = container.querySelector('button')
    expect(trigger).toBeInTheDocument()
  })

  it('renders custom trigger when provided', () => {
    render(
      <Dropdown
        items={mockItems}
        onSelect={onSelect}
        renderTrigger={open => <button data-testid="custom-trigger">{open ? 'Open' : 'Closed'}</button>}
      />,
    )
    const trigger = screen.getByTestId('custom-trigger')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('Closed')
  })

  it('opens dropdown menu on trigger click and shows items', async () => {
    render(
      <Dropdown items={mockItems} onSelect={onSelect} />,
    )
    const trigger = screen.getByRole('button')

    await act(async () => {
      fireEvent.click(trigger)
    })

    // Dropdown items are rendered in a portal (document.body)
    expect(screen.getByText('Option 1')).toBeInTheDocument()
    expect(screen.getByText('Option 2')).toBeInTheDocument()
  })

  it('calls onSelect and closes dropdown when an item is clicked', async () => {
    render(
      <Dropdown items={mockItems} onSelect={onSelect} />,
    )
    const trigger = screen.getByRole('button')

    await act(async () => {
      fireEvent.click(trigger)
    })

    const option1 = screen.getByText('Option 1')
    await act(async () => {
      fireEvent.click(option1)
    })

    expect(onSelect).toHaveBeenCalledWith(mockItems[0])
    expect(screen.queryByText('Option 1')).not.toBeInTheDocument()
  })

  it('calls onSelect and closes dropdown when a second item is clicked', async () => {
    render(
      <Dropdown items={mockItems} secondItems={mockSecondItems} onSelect={onSelect} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    const option3 = screen.getByText('Option 3')
    await act(async () => {
      fireEvent.click(option3)
    })
    expect(onSelect).toHaveBeenCalledWith(mockSecondItems[0])
    expect(screen.queryByText('Option 3')).not.toBeInTheDocument()
  })

  it('renders second items and divider when provided', async () => {
    render(
      <Dropdown
        items={mockItems}
        secondItems={mockSecondItems}
        onSelect={onSelect}
      />,
    )
    const trigger = screen.getByRole('button')

    await act(async () => {
      fireEvent.click(trigger)
    })

    expect(screen.getByText('Option 1')).toBeInTheDocument()
    expect(screen.getByText('Option 3')).toBeInTheDocument()

    // Check for divider (h-px bg-divider-regular)
    const divider = document.body.querySelector('.bg-divider-regular.h-px')
    expect(divider).toBeInTheDocument()
  })

  it('applies custom classNames', async () => {
    const popupClass = 'custom-popup'
    const itemClass = 'custom-item'
    const secondItemClass = 'custom-second-item'

    render(
      <Dropdown
        items={mockItems}
        secondItems={mockSecondItems}
        onSelect={onSelect}
        popupClassName={popupClass}
        itemClassName={itemClass}
        secondItemClassName={secondItemClass}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    const popup = document.body.querySelector(`.${popupClass}`)
    expect(popup).toBeInTheDocument()

    const items = screen.getAllByText('Option 1')
    expect(items[0]).toHaveClass(itemClass)

    const secondItems = screen.getAllByText('Option 3')
    expect(secondItems[0]).toHaveClass(secondItemClass)
  })

  it('applies open class to trigger when menu is open', async () => {
    render(<Dropdown items={mockItems} onSelect={onSelect} />)
    const trigger = screen.getByRole('button')
    await act(async () => {
      fireEvent.click(trigger)
    })
    expect(trigger).toHaveClass('bg-divider-regular')
  })

  it('handles JSX elements as item text', async () => {
    const itemsWithJSX = [
      { value: 'jsx', text: <span data-testid="jsx-item">JSX Content</span> },
    ]
    render(
      <Dropdown items={itemsWithJSX} onSelect={onSelect} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    expect(screen.getByTestId('jsx-item')).toBeInTheDocument()
    expect(screen.getByText('JSX Content')).toBeInTheDocument()
  })

  it('does not render items section if items list is empty', async () => {
    render(
      <Dropdown items={[]} secondItems={mockSecondItems} onSelect={onSelect} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    const p1Divs = document.body.querySelectorAll('.p-1')
    expect(p1Divs.length).toBe(1)
    expect(screen.queryByText('Option 1')).not.toBeInTheDocument()
    expect(screen.getByText('Option 3')).toBeInTheDocument()
  })

  it('does not render divider if only one section is provided', async () => {
    const { rerender } = render(
      <Dropdown items={mockItems} onSelect={onSelect} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(document.body.querySelector('.bg-divider-regular.h-px')).not.toBeInTheDocument()

    await act(async () => {
      rerender(
        <Dropdown items={[]} secondItems={mockSecondItems} onSelect={onSelect} />,
      )
    })
    expect(document.body.querySelector('.bg-divider-regular.h-px')).not.toBeInTheDocument()
  })

  it('renders nothing if both item lists are empty', async () => {
    render(<Dropdown items={[]} secondItems={[]} onSelect={onSelect} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    const popup = document.body.querySelector('.bg-components-panel-bg')
    expect(popup?.children.length).toBe(0)
  })

  it('passes triggerProps to ActionButton and applies custom className', () => {
    render(
      <Dropdown
        items={mockItems}
        onSelect={onSelect}
        triggerProps={{
          'disabled': true,
          'aria-label': 'dropdown-trigger',
          'className': 'custom-trigger-class',
        }}
      />,
    )
    const trigger = screen.getByLabelText('dropdown-trigger')
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveClass('custom-trigger-class')
  })
})
