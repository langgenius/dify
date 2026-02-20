import type { Option } from './custom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CustomSelect from './custom'

const options: Option[] = [
  { label: 'First option', value: 'first' },
  { label: 'Second option', value: 'second' },
]

describe('CustomSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior and value fallback.
  describe('Rendering', () => {
    it('should show the placeholder when value is undefined or not found', () => {
      const { rerender } = render(
        <CustomSelect options={options} />,
      )

      expect(screen.getByTitle(/select/i)).toBeInTheDocument()

      rerender(
        <CustomSelect options={options} value="missing" />,
      )

      expect(screen.getByTitle(/select/i)).toBeInTheDocument()
    })
  })

  // User interactions for opening and selecting options.
  describe('User Interactions', () => {
    it('should call onChange and close the popup when an option is selected', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <CustomSelect options={options} onChange={onChange} />,
      )

      await user.click(screen.getByTitle(/select/i))
      expect(screen.getByTitle('Second option')).toBeInTheDocument()

      await user.click(screen.getByTitle('Second option'))
      expect(onChange).toHaveBeenCalledWith('second')
      expect(screen.queryByTitle('Second option')).not.toBeInTheDocument()
    })
  })

  // Controlled container props behavior.
  describe('Container Props', () => {
    it('should delegate open-state changes through containerProps.onOpenChange', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()

      render(
        <CustomSelect
          options={options}
          containerProps={{ open: true, onOpenChange }}
        />,
      )

      expect(screen.getByTitle('First option')).toBeInTheDocument()

      await user.click(screen.getByTitle(/select/i))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  // Custom rendering hooks for trigger and options.
  describe('Custom Renderers', () => {
    it('should render CustomTrigger and CustomOption with selected state', async () => {
      const user = userEvent.setup()

      render(
        <CustomSelect
          options={options}
          value="first"
          CustomTrigger={(option, open) => <div>{`${option?.label ?? 'none'}-${open ? 'open' : 'closed'}`}</div>}
          CustomOption={(option, selected) => <div>{`${option.label}-${selected ? 'selected' : 'idle'}`}</div>}
        />,
      )

      expect(screen.getByText('First option-closed')).toBeInTheDocument()

      await user.click(screen.getByText('First option-closed'))

      expect(screen.getByText('First option-open')).toBeInTheDocument()
      expect(screen.getByText('First option-selected')).toBeInTheDocument()
      expect(screen.getByText('Second option-idle')).toBeInTheDocument()
    })
  })

  // Class-based customization props.
  describe('Style Props', () => {
    it('should apply trigger and popup class names from props', async () => {
      const user = userEvent.setup()

      render(
        <CustomSelect
          options={options}
          triggerProps={{ className: 'trigger-class' }}
          popupProps={{
            wrapperClassName: 'wrapper-class',
            className: 'popup-class',
            itemClassName: 'item-class',
          }}
        />,
      )

      const triggerLabel = screen.getByTitle(/select/i)
      const trigger = triggerLabel.parentElement
      expect(trigger).toHaveClass('trigger-class')

      await user.click(triggerLabel)

      expect(document.querySelector('.wrapper-class')).toBeInTheDocument()
      expect(document.querySelector('.popup-class')).toBeInTheDocument()
      expect(document.querySelectorAll('.item-class')).toHaveLength(options.length)
    })
  })
})
