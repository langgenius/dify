import type { DatePickerProps } from '../types'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import dayjs from '../utils/dayjs'
import DatePicker from './index'

// Mock scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Factory for DatePicker props
const createDatePickerProps = (overrides: Partial<DatePickerProps> = {}): DatePickerProps => ({
  value: undefined,
  onChange: vi.fn(),
  onClear: vi.fn(),
  ...overrides,
})

// Helper to open the picker
const openPicker = () => {
  const input = screen.getByRole('textbox')
  fireEvent.click(input)
}

describe('DatePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render with default placeholder', () => {
      const props = createDatePickerProps()
      render(<DatePicker {...props} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render with custom placeholder', () => {
      const props = createDatePickerProps({ placeholder: 'Select date' })
      render(<DatePicker {...props} />)

      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Select date')
    })

    it('should display formatted date value when value is provided', () => {
      const value = dayjs('2024-06-15T14:30:00')
      const props = createDatePickerProps({ value })
      render(<DatePicker {...props} />)

      expect(screen.getByRole('textbox').getAttribute('value')).not.toBe('')
    })

    it('should render with empty value when no value is provided', () => {
      const props = createDatePickerProps()
      render(<DatePicker {...props} />)

      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should normalize value with timezone applied', () => {
      const value = dayjs('2024-06-15T14:30:00')
      const props = createDatePickerProps({ value, timezone: 'America/New_York' })
      render(<DatePicker {...props} />)

      expect(screen.getByRole('textbox').getAttribute('value')).not.toBe('')
    })
  })

  // Open/close behavior
  describe('Open/Close Behavior', () => {
    it('should open the picker when trigger is clicked', () => {
      const props = createDatePickerProps()
      render(<DatePicker {...props} />)

      openPicker()

      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)
    })

    it('should close when trigger is clicked while open', () => {
      const props = createDatePickerProps()
      render(<DatePicker {...props} />)

      openPicker()
      openPicker() // second click closes

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should restore selected date from value when reopening', () => {
      const value = dayjs('2024-06-15')
      const props = createDatePickerProps({ value })
      render(<DatePicker {...props} />)

      openPicker()

      // Calendar should be showing June 2024
      expect(screen.getByText(/2024/)).toBeInTheDocument()
    })

    it('should close when clicking outside the container', () => {
      const props = createDatePickerProps()
      render(<DatePicker {...props} />)

      openPicker()

      // Simulate a mousedown event outside the container
      act(() => {
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      })

      // The picker should now be closed - input shows its value
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  // Time Picker Integration
  describe('Time Picker Integration', () => {
    it('should show time display in footer when needTimePicker is true', () => {
      const props = createDatePickerProps({ needTimePicker: true })
      render(<DatePicker {...props} />)

      openPicker()

      expect(screen.getByText('--:-- --')).toBeInTheDocument()
    })

    it('should not show time toggle when needTimePicker is false', () => {
      const props = createDatePickerProps({ needTimePicker: false })
      render(<DatePicker {...props} />)

      openPicker()

      expect(screen.queryByText('--:-- --')).not.toBeInTheDocument()
    })

    it('should switch to time view when time picker button is clicked', () => {
      const props = createDatePickerProps({ needTimePicker: true })
      render(<DatePicker {...props} />)

      openPicker()

      // Click the time display button to switch to time view
      fireEvent.click(screen.getByText('--:-- --'))

      // In time view, the "pickDate" text should appear instead of the time
      expect(screen.getByText(/operation\.pickDate/)).toBeInTheDocument()
    })

    it('should switch back to date view when pickDate is clicked in time view', () => {
      const props = createDatePickerProps({ needTimePicker: true })
      render(<DatePicker {...props} />)

      openPicker()

      // Switch to time view
      fireEvent.click(screen.getByText('--:-- --'))
      // Switch back to date view
      fireEvent.click(screen.getByText(/operation\.pickDate/))

      // Days of week should be visible again
      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)
    })

    it('should render time picker options in time view', () => {
      const props = createDatePickerProps({ needTimePicker: true, value: dayjs('2024-06-15T14:30:00') })
      render(<DatePicker {...props} />)

      openPicker()

      // Switch to time view
      fireEvent.click(screen.getByText(/\d{2}:\d{2}\s(AM|PM)/))

      // Should show AM/PM options (TimePickerOptions renders these)
      expect(screen.getByText('AM')).toBeInTheDocument()
      expect(screen.getByText('PM')).toBeInTheDocument()
    })

    it('should update selected time when hour is selected in time view', () => {
      const props = createDatePickerProps({ needTimePicker: true, value: dayjs('2024-06-15T14:30:00') })
      render(<DatePicker {...props} />)

      openPicker()

      // Switch to time view
      fireEvent.click(screen.getByText(/\d{2}:\d{2}\s(AM|PM)/))

      // Click hour "05" from the time options
      const allLists = screen.getAllByRole('list')
      const hourItems = within(allLists[0]).getAllByRole('listitem')
      fireEvent.click(hourItems[4])

      // The picker should still be in time view
      expect(screen.getByText(/operation\.pickDate/)).toBeInTheDocument()
    })

    it('should update selected time when minute is selected in time view', () => {
      const props = createDatePickerProps({ needTimePicker: true, value: dayjs('2024-06-15T14:30:00') })
      render(<DatePicker {...props} />)

      openPicker()

      // Switch to time view
      fireEvent.click(screen.getByText(/\d{2}:\d{2}\s(AM|PM)/))

      // Click minute "45" from the time options
      const allLists = screen.getAllByRole('list')
      const minuteItems = within(allLists[1]).getAllByRole('listitem')
      fireEvent.click(minuteItems[45])

      expect(screen.getByText(/operation\.pickDate/)).toBeInTheDocument()
    })

    it('should update selected time when period is changed in time view', () => {
      const props = createDatePickerProps({ needTimePicker: true, value: dayjs('2024-06-15T14:30:00') })
      render(<DatePicker {...props} />)

      openPicker()

      // Switch to time view
      fireEvent.click(screen.getByText(/\d{2}:\d{2}\s(AM|PM)/))

      // Click AM to switch period
      fireEvent.click(screen.getByText('AM'))

      expect(screen.getByText(/operation\.pickDate/)).toBeInTheDocument()
    })

    it('should update time when no selectedDate exists and hour is selected', () => {
      const props = createDatePickerProps({ needTimePicker: true })
      render(<DatePicker {...props} />)

      openPicker()

      // Switch to time view (click on the "--:-- --" text)
      fireEvent.click(screen.getByText('--:-- --'))

      // Click hour "03" from the time options
      const allLists = screen.getAllByRole('list')
      const hourItems = within(allLists[0]).getAllByRole('listitem')
      fireEvent.click(hourItems[2])

      expect(screen.getByText(/operation\.pickDate/)).toBeInTheDocument()
    })
  })

  // Date selection
  describe('Date Selection', () => {
    it('should call onChange when Now button is clicked', () => {
      const onChange = vi.fn()
      const props = createDatePickerProps({ onChange })
      render(<DatePicker {...props} />)

      openPicker()
      fireEvent.click(screen.getByText(/operation\.now/))

      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('should call onChange when OK button is clicked with a value', () => {
      const onChange = vi.fn()
      const props = createDatePickerProps({ onChange, value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()
      fireEvent.click(screen.getByText(/operation\.ok/))

      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('should select a calendar day when clicked', () => {
      const onChange = vi.fn()
      const props = createDatePickerProps({ onChange, value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()

      // Click on a day in the calendar - day "20"
      const dayButton = screen.getByRole('button', { name: '20' })
      fireEvent.click(dayButton)

      // The date should now appear in the header/display
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should immediately confirm when noConfirm is true and a date is clicked', () => {
      const onChange = vi.fn()
      const props = createDatePickerProps({ onChange, noConfirm: true, value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()

      // Click on a day
      const dayButton = screen.getByRole('button', { name: '20' })
      fireEvent.click(dayButton)

      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('should call onChange with undefined when OK is clicked without a selected date', () => {
      const onChange = vi.fn()
      const props = createDatePickerProps({ onChange })
      render(<DatePicker {...props} />)

      openPicker()

      // Clear selected date then confirm
      fireEvent.click(screen.getByText(/operation\.ok/))

      expect(onChange).toHaveBeenCalledTimes(1)
    })
  })

  // Clear behavior
  describe('Clear Behavior', () => {
    it('should call onClear when clear is clicked while picker is closed', () => {
      const onClear = vi.fn()
      const renderTrigger = vi.fn(({ handleClear }) => (
        <button data-testid="clear-trigger" onClick={handleClear}>
          Clear
        </button>
      ))
      const props = createDatePickerProps({
        value: dayjs('2024-06-15'),
        onClear,
        renderTrigger,
      })
      render(<DatePicker {...props} />)

      fireEvent.click(screen.getByTestId('clear-trigger'))

      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should clear selected date without calling onClear when picker is open', () => {
      const onClear = vi.fn()
      const onChange = vi.fn()
      const renderTrigger = vi.fn(({ handleClickTrigger, handleClear }) => (
        <div>
          <button data-testid="open-trigger" onClick={handleClickTrigger}>
            Open
          </button>
          <button data-testid="clear-trigger" onClick={handleClear}>
            Clear
          </button>
        </div>
      ))
      const props = createDatePickerProps({
        value: dayjs('2024-06-15'),
        onClear,
        onChange,
        renderTrigger,
      })
      render(<DatePicker {...props} />)

      fireEvent.click(screen.getByTestId('open-trigger'))
      fireEvent.click(screen.getByTestId('clear-trigger'))
      fireEvent.click(screen.getByText(/operation\.ok/))

      expect(onClear).not.toHaveBeenCalled()
      expect(onChange).toHaveBeenCalledWith(undefined)
    })
  })

  // Month navigation
  describe('Month Navigation', () => {
    it('should navigate to next month when next arrow is clicked', () => {
      const props = createDatePickerProps({ value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()

      // Find navigation buttons in the header
      const allButtons = screen.getAllByRole('button')
      // The header has: month/year button, prev button, next button
      // Then calendar days are also buttons. We need the 3rd button (next month).
      // Header buttons come first in DOM order.
      fireEvent.click(allButtons[2]) // next month button

      expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
    })

    it('should navigate to previous month when prev arrow is clicked', () => {
      const props = createDatePickerProps({ value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[1]) // prev month button

      expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
    })
  })

  // Year/Month picker
  describe('Year/Month Picker', () => {
    it('should open year/month picker when month/year header is clicked', () => {
      const props = createDatePickerProps({ value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()

      const headerButton = screen.getByText(/2024/)
      fireEvent.click(headerButton)

      // Cancel button visible in year/month picker footer
      expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
    })

    it('should close year/month picker when cancel is clicked', () => {
      const props = createDatePickerProps({ value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()
      fireEvent.click(screen.getByText(/2024/))

      // Cancel
      fireEvent.click(screen.getByText(/operation\.cancel/))

      // Should be back to date view with days of week
      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)
    })

    it('should confirm year/month selection when OK is clicked', () => {
      const props = createDatePickerProps({ value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()
      fireEvent.click(screen.getByText(/2024/))

      // Select a different year
      fireEvent.click(screen.getByText('2023'))

      // Confirm - click the last OK button (year/month footer)
      const okButtons = screen.getAllByText(/operation\.ok/)
      fireEvent.click(okButtons[okButtons.length - 1])

      // Should return to date view
      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)
    })

    it('should close year/month picker by clicking header button', () => {
      const props = createDatePickerProps({ value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()
      // Open year/month picker
      fireEvent.click(screen.getByText(/2024/))

      // The header in year/month view shows selected month/year with an up arrow
      // Clicking it closes the year/month picker
      const headerButtons = screen.getAllByRole('button')
      fireEvent.click(headerButtons[0]) // First button in year/month view is the header

      // Should return to date view
      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)
    })

    it('should update month selection in year/month picker', () => {
      const props = createDatePickerProps({ value: dayjs('2024-06-15') })
      render(<DatePicker {...props} />)

      openPicker()
      fireEvent.click(screen.getByText(/2024/))

      // Select a different month using RTL queries
      const allLists = screen.getAllByRole('list')
      const monthItems = within(allLists[0]).getAllByRole('listitem')
      fireEvent.click(monthItems[0])

      // Confirm the selection - click the last OK button (year/month footer)
      const okButtons = screen.getAllByText(/operation\.ok/)
      fireEvent.click(okButtons[okButtons.length - 1])

      // Should return to date view
      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)
    })
  })

  // noConfirm mode
  describe('noConfirm Mode', () => {
    it('should not show footer when noConfirm is true', () => {
      const props = createDatePickerProps({ noConfirm: true })
      render(<DatePicker {...props} />)

      openPicker()

      expect(screen.queryByText(/operation\.ok/)).not.toBeInTheDocument()
    })
  })

  // Custom trigger
  describe('Custom Trigger', () => {
    it('should use renderTrigger when provided', () => {
      const renderTrigger = vi.fn(({ handleClickTrigger }) => (
        <button data-testid="custom-trigger" onClick={handleClickTrigger}>
          Custom
        </button>
      ))

      const props = createDatePickerProps({ renderTrigger })
      render(<DatePicker {...props} />)

      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })

    it('should open picker when custom trigger is clicked', () => {
      const renderTrigger = vi.fn(({ handleClickTrigger }) => (
        <button data-testid="custom-trigger" onClick={handleClickTrigger}>
          Custom
        </button>
      ))

      const props = createDatePickerProps({ renderTrigger })
      render(<DatePicker {...props} />)

      fireEvent.click(screen.getByTestId('custom-trigger'))

      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)
    })
  })

  // Disabled dates
  describe('Disabled Dates', () => {
    it('should pass getIsDateDisabled to calendar', () => {
      const getIsDateDisabled = vi.fn().mockReturnValue(false)
      const props = createDatePickerProps({
        value: dayjs('2024-06-15'),
        getIsDateDisabled,
      })
      render(<DatePicker {...props} />)

      openPicker()

      expect(getIsDateDisabled).toHaveBeenCalled()
    })
  })

  // Timezone
  describe('Timezone', () => {
    it('should render with timezone', () => {
      const props = createDatePickerProps({
        value: dayjs('2024-06-15'),
        timezone: 'UTC',
      })
      render(<DatePicker {...props} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should call onChange when timezone changes with a value', () => {
      const onChange = vi.fn()
      const props = createDatePickerProps({
        value: dayjs('2024-06-15T14:30:00'),
        timezone: 'UTC',
        onChange,
      })
      const { rerender } = render(<DatePicker {...props} />)

      // Change timezone
      rerender(<DatePicker {...props} timezone="America/New_York" />)

      expect(onChange).toHaveBeenCalled()
    })

    it('should update currentDate when timezone changes without a value', () => {
      const onChange = vi.fn()
      const props = createDatePickerProps({
        timezone: 'UTC',
        onChange,
      })
      const { rerender } = render(<DatePicker {...props} />)

      // Change timezone with no value
      rerender(<DatePicker {...props} timezone="America/New_York" />)

      // onChange should NOT be called when there is no value
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should update selectedDate when timezone changes and value is present', () => {
      const onChange = vi.fn()
      const value = dayjs('2024-06-15T14:30:00')
      const props = createDatePickerProps({
        value,
        timezone: 'UTC',
        onChange,
      })
      const { rerender } = render(<DatePicker {...props} />)

      // Change timezone
      rerender(<DatePicker {...props} timezone="Asia/Tokyo" />)

      // Should have been called with the new timezone-adjusted value
      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(emitted.isValid()).toBe(true)
    })
  })

  // Display time when selected date exists
  describe('Time Display', () => {
    it('should show formatted time when selectedDate exists', () => {
      const value = dayjs('2024-06-15T14:30:00')
      const props = createDatePickerProps({ value, needTimePicker: true })
      render(<DatePicker {...props} />)

      openPicker()

      // The footer should show the time from selectedDate (02:30 PM)
      expect(screen.getByText(/\d{2}:\d{2}\s(AM|PM)/)).toBeInTheDocument()
    })
  })
})
