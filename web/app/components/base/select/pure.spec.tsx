import type { Option } from './pure'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PureSelect from './pure'

const options: Option[] = [
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Citrus', value: 'citrus' },
]

describe('PureSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering and placeholder behavior in single/multiple modes.
  describe('Rendering', () => {
    it('should render i18n placeholder when single value is empty', () => {
      render(<PureSelect options={options} />)
      expect(screen.getByTitle(/select/i)).toBeInTheDocument()
    })

    it('should render custom placeholder when provided', () => {
      render(<PureSelect options={options} placeholder="Choose value" />)
      expect(screen.getByTitle('Choose value')).toBeInTheDocument()
    })

    it('should render selected option label in single mode', () => {
      render(<PureSelect options={options} value="banana" />)
      expect(screen.getByTitle('Banana')).toBeInTheDocument()
    })

    it('should render selected count text in multiple mode', () => {
      render(<PureSelect options={options} multiple={true} value={['apple', 'banana']} />)
      expect(screen.getByText(/selected/i)).toBeInTheDocument()
    })
  })

  // Interaction behavior in single and multiple selection modes.
  describe('User Interactions', () => {
    it('should call onChange and close popup when selecting an option in single mode', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(<PureSelect options={options} onChange={onChange} />)

      await user.click(screen.getByTitle(/select/i))
      expect(screen.getByTitle('Banana')).toBeInTheDocument()

      await user.click(screen.getByTitle('Banana'))

      expect(onChange).toHaveBeenCalledWith('banana')
      expect(screen.queryByTitle('Citrus')).not.toBeInTheDocument()
    })

    it('should append a new value in multiple mode when clicking an unselected option', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <PureSelect
          options={options}
          multiple={true}
          value={['apple']}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText(/common\.dynamicSelect\.selected/i))
      await user.click(screen.getAllByTitle('Banana')[0])

      expect(onChange).toHaveBeenCalledWith(['apple', 'banana'])
    })

    it('should remove an existing value in multiple mode when clicking a selected option', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <PureSelect
          options={options}
          multiple={true}
          value={['apple', 'banana']}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText(/common\.dynamicSelect\.selected/i))
      await user.click(screen.getAllByTitle('Apple')[0])

      expect(onChange).toHaveBeenCalledWith(['banana'])
    })
  })

  // Controlled open state and disabled behavior.
  describe('Container And Disabled Props', () => {
    it('should call containerProps.onOpenChange when trigger is clicked in controlled mode', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()

      render(
        <PureSelect
          options={options}
          containerProps={{ open: true, onOpenChange }}
        />,
      )

      expect(screen.getByTitle('Apple')).toBeInTheDocument()
      await user.click(screen.getByTitle(/select/i))

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('should not open popup when disabled', async () => {
      const user = userEvent.setup()

      render(
        <PureSelect
          options={options}
          disabled={true}
        />,
      )

      await user.click(screen.getByTitle(/select/i))
      expect(screen.queryByTitle('Apple')).not.toBeInTheDocument()
    })

    it('should ignore option clicks when disabled even if popup is open', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <PureSelect
          options={options}
          disabled={true}
          onChange={onChange}
          containerProps={{ open: true }}
        />,
      )

      await user.click(screen.getAllByTitle('Apple')[0])
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  // Style and popup customization props.
  describe('Style Props', () => {
    it('should apply trigger and popup class names and render popup title', () => {
      render(
        <PureSelect
          options={options}
          triggerProps={{ className: 'trigger-class' }}
          popupProps={{
            wrapperClassName: 'wrapper-class',
            className: 'popup-class',
            itemClassName: 'item-class',
            title: 'Available options',
            titleClassName: 'title-class',
          }}
          containerProps={{ open: true }}
        />,
      )

      const triggerLabel = screen.getByTitle(/select/i)
      const trigger = triggerLabel.parentElement

      expect(trigger).toHaveClass('trigger-class')
      expect(document.querySelector('.wrapper-class')).toBeInTheDocument()
      expect(document.querySelector('.popup-class')).toBeInTheDocument()
      expect(document.querySelectorAll('.item-class')).toHaveLength(options.length)
      expect(screen.getByText('Available options')).toHaveClass('title-class')
    })
  })
})
