import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TimePicker from './time-picker'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'time.title.pickTime': 'Pick Time',
        'common.operation.now': 'Now',
        'common.operation.ok': 'OK',
      }
      return translations[key] || key
    },
  }),
}))

describe('TimePicker', () => {
  const mockOnChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renders with default value', () => {
    render(<TimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    expect(button.textContent).toBe('11:30 AM')
  })

  test('renders with provided value', () => {
    render(<TimePicker value="2:30 PM" onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    expect(button.textContent).toBe('2:30 PM')
  })

  test('opens picker when button is clicked', () => {
    render(<TimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(screen.getByText('Pick Time')).toBeInTheDocument()
    expect(screen.getByText('Now')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  test('closes picker when clicking outside', () => {
    render(<TimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(screen.getByText('Pick Time')).toBeInTheDocument()

    const overlay = document.querySelector('.fixed.inset-0')
    fireEvent.click(overlay!)

    expect(screen.queryByText('Pick Time')).not.toBeInTheDocument()
  })

  test('button text remains unchanged when selecting time without clicking OK', () => {
    render(<TimePicker value="11:30 AM" onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    expect(button.textContent).toBe('11:30 AM')

    fireEvent.click(button)

    const hourButton = screen.getByText('3')
    fireEvent.click(hourButton)

    const minuteButton = screen.getByText('45')
    fireEvent.click(minuteButton)

    const pmButton = screen.getByText('PM')
    fireEvent.click(pmButton)

    expect(button.textContent).toBe('11:30 AM')
    expect(mockOnChange).not.toHaveBeenCalled()

    const overlay = document.querySelector('.fixed.inset-0')
    fireEvent.click(overlay!)

    expect(button.textContent).toBe('11:30 AM')
  })

  test('calls onChange when clicking OK button', () => {
    render(<TimePicker value="11:30 AM" onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const hourButton = screen.getByText('3')
    fireEvent.click(hourButton)

    const minuteButton = screen.getByText('45')
    fireEvent.click(minuteButton)

    const pmButton = screen.getByText('PM')
    fireEvent.click(pmButton)

    const okButton = screen.getByText('OK')
    fireEvent.click(okButton)

    expect(mockOnChange).toHaveBeenCalledWith('3:45 PM')
  })

  test('calls onChange when clicking Now button', () => {
    const mockDate = new Date('2024-01-15T14:30:00')
    jest.spyOn(globalThis, 'Date').mockImplementation(() => mockDate)

    render(<TimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const nowButton = screen.getByText('Now')
    fireEvent.click(nowButton)

    expect(mockOnChange).toHaveBeenCalledWith('2:30 PM')

    jest.restoreAllMocks()
  })

  test('initializes picker with current value when opened', async () => {
    render(<TimePicker value="3:45 PM" onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    await waitFor(() => {
      const selectedHour = screen.getByText('3').closest('button')
      expect(selectedHour).toHaveClass('bg-gray-100')

      const selectedMinute = screen.getByText('45').closest('button')
      expect(selectedMinute).toHaveClass('bg-gray-100')

      const selectedPeriod = screen.getByText('PM').closest('button')
      expect(selectedPeriod).toHaveClass('bg-gray-100')
    })
  })

  test('resets picker selection when reopening after closing without OK', async () => {
    render(<TimePicker value="11:30 AM" onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const hourButton = screen.getByText('3')
    fireEvent.click(hourButton)

    const overlay = document.querySelector('.fixed.inset-0')
    fireEvent.click(overlay!)

    fireEvent.click(button)

    await waitFor(() => {
      const hourButtons = screen.getAllByText('11')
      const selectedHourButton = hourButtons.find(btn => btn.closest('button')?.classList.contains('bg-gray-100'))
      expect(selectedHourButton).toBeTruthy()

      const notSelectedHour = screen.getByText('3').closest('button')
      expect(notSelectedHour).not.toHaveClass('bg-gray-100')
    })
  })

  test('handles 12 AM/PM correctly in Now button', () => {
    const mockMidnight = new Date('2024-01-15T00:30:00')
    jest.spyOn(globalThis, 'Date').mockImplementation(() => mockMidnight)

    render(<TimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const nowButton = screen.getByText('Now')
    fireEvent.click(nowButton)

    expect(mockOnChange).toHaveBeenCalledWith('12:30 AM')

    jest.restoreAllMocks()
  })

  test('handles 12 PM correctly in Now button', () => {
    const mockNoon = new Date('2024-01-15T12:30:00')
    jest.spyOn(globalThis, 'Date').mockImplementation(() => mockNoon)

    render(<TimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const nowButton = screen.getByText('Now')
    fireEvent.click(nowButton)

    expect(mockOnChange).toHaveBeenCalledWith('12:30 PM')

    jest.restoreAllMocks()
  })

  test('auto-scrolls to selected values when opened', async () => {
    const mockScrollIntoView = jest.fn()
    Element.prototype.scrollIntoView = mockScrollIntoView

    render(<TimePicker value="8:45 PM" onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockScrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      })
    }, { timeout: 200 })

    mockScrollIntoView.mockRestore()
  })
})
