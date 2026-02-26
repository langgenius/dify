import type { TimePickerProps } from '../types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import dayjs, { isDayjsObject } from '../utils/dayjs'
import TimePicker from './index'

// Mock scrollIntoView since jsdom doesn't implement it
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('TimePicker', () => {
  const baseProps: Pick<TimePickerProps, 'onChange' | 'onClear' | 'value'> = {
    onChange: vi.fn(),
    onClear: vi.fn(),
    value: undefined,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders formatted value for string input (Issue #26692 regression)', () => {
    render(
      <TimePicker
        {...baseProps}
        value="18:45"
        timezone="UTC"
      />,
    )

    expect(screen.getByDisplayValue('06:45 PM')).toBeInTheDocument()
  })

  it('confirms cleared value when confirming without selection', () => {
    render(
      <TimePicker
        {...baseProps}
        value={dayjs('2024-01-01T03:30:00Z')}
        timezone="UTC"
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.click(input)

    const clearButton = screen.getByRole('button', { name: /operation\.clear/i })
    fireEvent.click(clearButton)

    const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
    fireEvent.click(confirmButton)

    expect(baseProps.onChange).toHaveBeenCalledTimes(1)
    expect(baseProps.onChange).toHaveBeenCalledWith(undefined)
    expect(baseProps.onClear).not.toHaveBeenCalled()
  })

  it('selecting current time emits timezone-aware value', () => {
    const onChange = vi.fn()
    render(
      <TimePicker
        {...baseProps}
        onChange={onChange}
        timezone="America/New_York"
      />,
    )

    // Open the picker first to access content
    fireEvent.click(screen.getByRole('textbox'))

    const nowButton = screen.getByRole('button', { name: /operation\.now/i })
    fireEvent.click(nowButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    const emitted = onChange.mock.calls[0][0]
    expect(isDayjsObject(emitted)).toBe(true)
    expect(emitted?.utcOffset()).toBe(dayjs().tz('America/New_York').utcOffset())
  })

  // Opening and closing behavior tests
  describe('Open/Close Behavior', () => {
    it('should show placeholder when no value is provided', () => {
      render(<TimePicker {...baseProps} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', expect.stringMatching(/defaultPlaceholder/i))
    })

    it('should toggle open state when trigger is clicked', () => {
      render(<TimePicker {...baseProps} value="10:00 AM" timezone="UTC" />)

      const input = screen.getByRole('textbox')
      // Open
      fireEvent.click(input)
      expect(input).toHaveValue('')

      // Close by clicking again
      fireEvent.click(input)
      expect(input).toHaveValue('10:00 AM')
    })

    it('should call onClear when clear is clicked while picker is closed', () => {
      const onClear = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onClear={onClear}
          value="10:00 AM"
          timezone="UTC"
        />,
      )

      const clearButton = screen.getByRole('button', { name: /operation\.clear/i })
      fireEvent.click(clearButton)

      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should not call onClear when clear is clicked while picker is open', () => {
      const onClear = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onClear={onClear}
          value="10:00 AM"
          timezone="UTC"
        />,
      )

      // Open picker first
      fireEvent.click(screen.getByRole('textbox'))
      // Then clear
      const clearButton = screen.getByRole('button', { name: /operation\.clear/i })
      fireEvent.click(clearButton)

      expect(onClear).not.toHaveBeenCalled()
    })

    it('should register click outside listener on mount', () => {
      const addEventSpy = vi.spyOn(document, 'addEventListener')
      render(<TimePicker {...baseProps} value="10:00 AM" timezone="UTC" />)

      expect(addEventSpy).toHaveBeenCalledWith('mousedown', expect.any(Function))
      addEventSpy.mockRestore()
    })

    it('should sync selectedTime from value when opening with stale state', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value="10:00 AM"
          timezone="UTC"
        />,
      )

      const input = screen.getByRole('textbox')
      // Open - this triggers handleClickTrigger which syncs selectedTime from value
      fireEvent.click(input)

      // Confirm to verify selectedTime was synced from value prop ("10:00 AM")
      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)
      expect(onChange).toHaveBeenCalledTimes(1)

      const emitted = onChange.mock.calls[0][0]
      expect(isDayjsObject(emitted)).toBe(true)
      expect(emitted.hour()).toBe(10)
      expect(emitted.minute()).toBe(0)
    })

    it('should resync selectedTime when opening after internal clear', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T10:30:00Z')}
          timezone="UTC"
        />,
      )

      const input = screen.getByRole('textbox')
      // Open
      fireEvent.click(input)

      // Clear selected time internally
      const clearButton = screen.getByRole('button', { name: /operation\.clear/i })
      fireEvent.click(clearButton)

      // Close
      fireEvent.click(input)

      // Open again - should resync selectedTime from value prop
      fireEvent.click(input)

      // Confirm to verify the value was resynced
      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(isDayjsObject(emitted)).toBe(true)
      // Resynced from value prop: dayjs('2024-01-01T10:30:00Z') in UTC = 10:30 AM
      expect(emitted.hour()).toBe(10)
      expect(emitted.minute()).toBe(30)
    })
  })

  // Props tests
  describe('Props', () => {
    it('should show custom placeholder when provided', () => {
      render(
        <TimePicker
          {...baseProps}
          placeholder="Select time"
        />,
      )

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'Select time')
    })

    it('should render with triggerFullWidth prop without errors', () => {
      render(
        <TimePicker
          {...baseProps}
          triggerFullWidth={true}
        />,
      )

      // Verify the component renders successfully with triggerFullWidth
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should use renderTrigger when provided', () => {
      const renderTrigger = vi.fn(({ inputElem, onClick }) => (
        <div data-testid="custom-trigger" onClick={onClick}>
          {inputElem}
        </div>
      ))

      render(
        <TimePicker
          {...baseProps}
          renderTrigger={renderTrigger}
        />,
      )

      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
      expect(renderTrigger).toHaveBeenCalled()
    })

    it('should render with notClearable prop without errors', () => {
      render(
        <TimePicker
          {...baseProps}
          notClearable={true}
          value="10:00 AM"
          timezone="UTC"
        />,
      )

      // In test env the icon stays in DOM, but must remain hidden when notClearable is set
      expect(screen.getByRole('button', { name: /clear/i })).toHaveClass('hidden')
    })
  })

  // Confirm behavior tests
  describe('Confirm Behavior', () => {
    it('should emit selected time when confirm is clicked with a value', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T10:30:00Z')}
          timezone="UTC"
        />,
      )

      // Open the picker first to access content
      fireEvent.click(screen.getByRole('textbox'))

      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(isDayjsObject(emitted)).toBe(true)
      expect(emitted.hour()).toBe(10)
      expect(emitted.minute()).toBe(30)
    })
  })

  // Time selection handler tests
  describe('Time Selection', () => {
    const openPicker = () => {
      fireEvent.click(screen.getByRole('textbox'))
    }

    const getHourAndMinuteLists = () => {
      const allLists = screen.getAllByRole('list')
      const hourList = allLists.find(list =>
        within(list).queryByText('01')
        && within(list).queryByText('12')
        && !within(list).queryByText('59'))
      const minuteList = allLists.find(list =>
        within(list).queryByText('00')
        && within(list).queryByText('59'))

      expect(hourList).toBeTruthy()
      expect(minuteList).toBeTruthy()

      return {
        hourList: hourList!,
        minuteList: minuteList!,
      }
    }

    it('should update selectedTime when hour is selected', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T10:30:00Z')}
          timezone="UTC"
        />,
      )

      openPicker()

      // Click hour "05" from the time options
      const { hourList } = getHourAndMinuteLists()
      fireEvent.click(within(hourList).getByText('05'))

      // Now confirm to verify the selectedTime was updated
      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(isDayjsObject(emitted)).toBe(true)
      // Hour 05 in AM (since original was 10:30 AM) = 5
      expect(emitted.hour()).toBe(5)
    })

    it('should update selectedTime when minute is selected', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T10:30:00Z')}
          timezone="UTC"
        />,
      )

      openPicker()

      // Click minute "45" from the time options
      const { minuteList } = getHourAndMinuteLists()
      fireEvent.click(within(minuteList).getByText('45'))

      // Confirm
      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(emitted.minute()).toBe(45)
    })

    it('should update selectedTime when period is changed', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T10:30:00Z')}
          timezone="UTC"
        />,
      )

      openPicker()

      // Click PM to switch period
      fireEvent.click(screen.getByText('PM'))

      // Confirm
      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      // Original was 10:30 AM, switching to PM makes it 22:30
      expect(emitted.hour()).toBe(22)
    })

    it('should create new time when selecting hour without prior selectedTime', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          timezone="UTC"
        />,
      )

      openPicker()

      // Click hour "03" with no existing selectedTime
      const { hourList } = getHourAndMinuteLists()
      fireEvent.click(within(hourList).getByText('03'))

      // Confirm
      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(isDayjsObject(emitted)).toBe(true)
      expect(emitted.hour()).toBe(3)
    })

    it('should handle minute selection without prior selectedTime', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          timezone="UTC"
        />,
      )

      openPicker()

      // Click minute "15" with no existing selectedTime
      const { minuteList } = getHourAndMinuteLists()
      fireEvent.click(within(minuteList).getByText('15'))

      // Confirm
      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(emitted.minute()).toBe(15)
    })

    it('should handle period selection without prior selectedTime', () => {
      const onChange = vi.fn()
      render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          timezone="UTC"
        />,
      )

      openPicker()

      // Click PM with no existing selectedTime
      fireEvent.click(screen.getByText('PM'))

      // Confirm
      const confirmButton = screen.getByRole('button', { name: /operation\.ok/i })
      fireEvent.click(confirmButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(isDayjsObject(emitted)).toBe(true)
      expect(emitted.hour()).toBeGreaterThanOrEqual(12)
    })
  })

  // Timezone change effect tests
  describe('Timezone Changes', () => {
    it('should call onChange when timezone changes with an existing value', () => {
      const onChange = vi.fn()
      const value = dayjs('2024-01-01T10:30:00Z')
      const { rerender } = render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={value}
          timezone="UTC"
        />,
      )

      // Change timezone without changing value (same reference)
      rerender(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={value}
          timezone="America/New_York"
        />,
      )

      expect(onChange).toHaveBeenCalledTimes(1)
      const emitted = onChange.mock.calls[0][0]
      expect(isDayjsObject(emitted)).toBe(true)
      // 10:30 UTC converted to America/New_York (UTC-5 in Jan) = 05:30
      expect(emitted.utcOffset()).toBe(dayjs().tz('America/New_York').utcOffset())
      expect(emitted.hour()).toBe(5)
      expect(emitted.minute()).toBe(30)
    })

    it('should update selectedTime when value changes', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T10:30:00Z')}
          timezone="UTC"
        />,
      )

      // Change value
      rerender(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T14:00:00Z')}
          timezone="UTC"
        />,
      )

      // onChange should not be called when only value changes (no timezone change)
      expect(onChange).not.toHaveBeenCalled()

      // But the display should update
      expect(screen.getByDisplayValue('02:00 PM')).toBeInTheDocument()
    })

    it('should handle timezone change when value is undefined', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          timezone="UTC"
        />,
      )

      // Change timezone without a value
      rerender(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          timezone="America/New_York"
        />,
      )

      // onChange should not be called when value is undefined
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should handle timezone change when selectedTime exists but value becomes undefined', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T10:30:00Z')}
          timezone="UTC"
        />,
      )
      // Remove value and change timezone
      rerender(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={undefined}
          timezone="America/New_York"
        />,
      )
      // Input should be empty now
      expect(screen.getByRole('textbox')).toHaveValue('')
      // onChange should not fire when value is undefined, even if selectedTime was set
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should not update when neither timezone nor value changes', () => {
      const onChange = vi.fn()
      const value = dayjs('2024-01-01T10:30:00Z')
      const { rerender } = render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={value}
          timezone="UTC"
        />,
      )

      // Rerender with same props
      rerender(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={value}
          timezone="UTC"
        />,
      )

      expect(onChange).not.toHaveBeenCalled()
    })

    it('should update display when both value and timezone change', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T10:30:00Z')}
          timezone="UTC"
        />,
      )

      // Change both value and timezone simultaneously
      rerender(
        <TimePicker
          {...baseProps}
          onChange={onChange}
          value={dayjs('2024-01-01T15:00:00Z')}
          timezone="America/New_York"
        />,
      )

      // onChange should not be called since both changed (timezoneChanged && !valueChanged is false)
      expect(onChange).not.toHaveBeenCalled()

      // 15:00 UTC in America/New_York (UTC-5) = 10:00 AM
      expect(screen.getByDisplayValue('10:00 AM')).toBeInTheDocument()
    })
  })

  // Format time value tests
  describe('Format Time Value', () => {
    it('should return empty string when value is undefined', () => {
      render(<TimePicker {...baseProps} />)

      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should format dayjs value correctly', () => {
      render(
        <TimePicker
          {...baseProps}
          value={dayjs('2024-01-01T14:30:00Z')}
          timezone="UTC"
        />,
      )

      expect(screen.getByDisplayValue('02:30 PM')).toBeInTheDocument()
    })

    it('should format string value correctly', () => {
      render(
        <TimePicker
          {...baseProps}
          value="09:15"
          timezone="UTC"
        />,
      )

      expect(screen.getByDisplayValue('09:15 AM')).toBeInTheDocument()
    })
  })

  describe('Timezone Label Integration', () => {
    it('should not display timezone label by default', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
        />,
      )

      expect(screen.queryByTitle(/Timezone: Asia\/Shanghai/)).not.toBeInTheDocument()
    })

    it('should not display timezone label when showTimezone is false', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
          showTimezone={false}
        />,
      )

      expect(screen.queryByTitle(/Timezone: Asia\/Shanghai/)).not.toBeInTheDocument()
    })

    it('should display timezone label when showTimezone is true', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
          showTimezone={true}
        />,
      )

      const timezoneLabel = screen.getByTitle(/Timezone: Asia\/Shanghai/)
      expect(timezoneLabel).toBeInTheDocument()
      expect(timezoneLabel).toHaveTextContent(/UTC[+-]\d+/)
    })

    it('should not display timezone label when showTimezone is true but timezone is not provided', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          showTimezone={true}
        />,
      )

      expect(screen.queryByTitle(/Timezone:/)).not.toBeInTheDocument()
    })
  })
})
