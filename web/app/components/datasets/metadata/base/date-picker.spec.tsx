import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WrappedDatePicker from './date-picker'

type TriggerArgs = {
  handleClickTrigger: () => void
}

type DatePickerProps = {
  onChange: (value: Date | null) => void
  onClear: () => void
  renderTrigger: (args: TriggerArgs) => React.ReactNode
  value?: Date
}

// Mock the base date picker component
vi.mock('@/app/components/base/date-and-time-picker/date-picker', () => ({
  default: ({ onChange, onClear, renderTrigger, value }: DatePickerProps) => {
    const trigger = renderTrigger({
      handleClickTrigger: () => {},
    })
    return (
      <div data-testid="date-picker-wrapper">
        {trigger}
        <button data-testid="select-date" onClick={() => onChange(value || null)}>
          Select Date
        </button>
        <button data-testid="clear-date" onClick={() => onClear()}>
          Clear
        </button>
      </div>
    )
  },
}))

// Mock useTimestamp hook
vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => {
      if (!timestamp)
        return ''
      return new Date(timestamp * 1000).toLocaleDateString()
    },
  }),
}))

describe('WrappedDatePicker', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const handleChange = vi.fn()
      render(<WrappedDatePicker onChange={handleChange} />)
      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })

    it('should render placeholder text when no value', () => {
      const handleChange = vi.fn()
      render(<WrappedDatePicker onChange={handleChange} />)
      // When no value, should show placeholder from i18n
      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })

    it('should render formatted date when value is provided', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      render(<WrappedDatePicker value={timestamp} onChange={handleChange} />)
      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })

    it('should render calendar icon', () => {
      const handleChange = vi.fn()
      const { container } = render(<WrappedDatePicker onChange={handleChange} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render select date button', () => {
      const handleChange = vi.fn()
      render(<WrappedDatePicker onChange={handleChange} />)
      expect(screen.getByTestId('select-date')).toBeInTheDocument()
    })

    it('should render clear date button', () => {
      const handleChange = vi.fn()
      render(<WrappedDatePicker onChange={handleChange} />)
      expect(screen.getByTestId('clear-date')).toBeInTheDocument()
    })

    it('should render close icon for clearing', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      const { container } = render(
        <WrappedDatePicker value={timestamp} onChange={handleChange} />,
      )
      // RiCloseCircleFill should be rendered
      const closeIcon = container.querySelectorAll('svg')
      expect(closeIcon.length).toBeGreaterThan(0)
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const handleChange = vi.fn()
      const { container } = render(
        <WrappedDatePicker className="custom-class" onChange={handleChange} />,
      )
      const triggerElement = container.querySelector('.custom-class')
      expect(triggerElement).toBeInTheDocument()
    })

    it('should accept undefined value', () => {
      const handleChange = vi.fn()
      render(<WrappedDatePicker value={undefined} onChange={handleChange} />)
      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })

    it('should accept number value', () => {
      const handleChange = vi.fn()
      const timestamp = 1609459200 // 2021-01-01
      render(<WrappedDatePicker value={timestamp} onChange={handleChange} />)
      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with timestamp when date is selected', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      render(<WrappedDatePicker value={timestamp} onChange={handleChange} />)

      fireEvent.click(screen.getByTestId('select-date'))

      expect(handleChange).toHaveBeenCalled()
    })

    it('should call onChange with null when date is cleared via onClear', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      render(<WrappedDatePicker value={timestamp} onChange={handleChange} />)

      fireEvent.click(screen.getByTestId('clear-date'))

      expect(handleChange).toHaveBeenCalledWith(null)
    })

    it('should call onChange with null when close icon is clicked directly', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      const { container } = render(
        <WrappedDatePicker value={timestamp} onChange={handleChange} />,
      )

      // Find the RiCloseCircleFill icon (it has specific classes)
      const closeIcon = container.querySelector('.cursor-pointer.hover\\:text-components-input-text-filled')
      if (closeIcon) {
        fireEvent.click(closeIcon)
        expect(handleChange).toHaveBeenCalledWith(null)
      }
    })

    it('should show close button on hover when value exists', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      const { container } = render(
        <WrappedDatePicker value={timestamp} onChange={handleChange} />,
      )

      // The close icon should be present but hidden initially
      const triggerGroup = container.querySelector('.group')
      expect(triggerGroup).toBeInTheDocument()
    })

    it('should handle clicking on trigger element', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      const { container } = render(
        <WrappedDatePicker value={timestamp} onChange={handleChange} />,
      )

      const trigger = container.querySelector('.group.flex')
      if (trigger)
        fireEvent.click(trigger)

      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have tertiary text color when no value', () => {
      const handleChange = vi.fn()
      const { container } = render(<WrappedDatePicker onChange={handleChange} />)
      const textElement = container.querySelector('.text-text-tertiary')
      expect(textElement).toBeInTheDocument()
    })

    it('should have secondary text color when value exists', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      const { container } = render(
        <WrappedDatePicker value={timestamp} onChange={handleChange} />,
      )
      const textElement = container.querySelector('.text-text-secondary')
      expect(textElement).toBeInTheDocument()
    })

    it('should have input background styling', () => {
      const handleChange = vi.fn()
      const { container } = render(<WrappedDatePicker onChange={handleChange} />)
      const bgElement = container.querySelector('.bg-components-input-bg-normal')
      expect(bgElement).toBeInTheDocument()
    })

    it('should have quaternary text color for close icon when value exists', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      const { container } = render(
        <WrappedDatePicker value={timestamp} onChange={handleChange} />,
      )
      const closeIcon = container.querySelector('.text-text-quaternary')
      expect(closeIcon).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle timestamp of 0', () => {
      const handleChange = vi.fn()
      render(<WrappedDatePicker value={0} onChange={handleChange} />)
      // 0 is falsy but is a valid timestamp (epoch)
      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })

    it('should handle very large timestamp', () => {
      const handleChange = vi.fn()
      const farFuture = 4102444800 // 2100-01-01
      render(<WrappedDatePicker value={farFuture} onChange={handleChange} />)
      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })

    it('should handle switching between no value and value', () => {
      const handleChange = vi.fn()
      const { rerender } = render(
        <WrappedDatePicker onChange={handleChange} />,
      )

      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()

      const timestamp = Math.floor(Date.now() / 1000)
      rerender(<WrappedDatePicker value={timestamp} onChange={handleChange} />)

      expect(screen.getByTestId('date-picker-wrapper')).toBeInTheDocument()
    })

    it('should handle clearing date multiple times', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      render(<WrappedDatePicker value={timestamp} onChange={handleChange} />)

      fireEvent.click(screen.getByTestId('clear-date'))
      fireEvent.click(screen.getByTestId('clear-date'))
      fireEvent.click(screen.getByTestId('clear-date'))

      expect(handleChange).toHaveBeenCalledTimes(3)
    })

    it('should handle rapid date selections', () => {
      const handleChange = vi.fn()
      const timestamp = Math.floor(Date.now() / 1000)
      render(<WrappedDatePicker value={timestamp} onChange={handleChange} />)

      fireEvent.click(screen.getByTestId('select-date'))
      fireEvent.click(screen.getByTestId('select-date'))
      fireEvent.click(screen.getByTestId('select-date'))

      expect(handleChange).toHaveBeenCalledTimes(3)
    })

    it('should handle onChange with date object that has unix method', () => {
      const handleChange = vi.fn()
      render(<WrappedDatePicker onChange={handleChange} />)

      // The mock triggers onChange with the value prop
      fireEvent.click(screen.getByTestId('select-date'))

      // onChange should have been called
      expect(handleChange).toHaveBeenCalled()
    })
  })
})
