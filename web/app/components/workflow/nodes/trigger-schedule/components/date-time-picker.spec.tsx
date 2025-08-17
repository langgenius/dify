import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DateTimePicker from './date-time-picker'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'workflow.nodes.triggerSchedule.selectDateTime': 'Select Date & Time',
        'common.operation.now': 'Now',
        'common.operation.ok': 'OK',
      }
      return translations[key] || key
    },
  }),
}))

describe('DateTimePicker', () => {
  const mockOnChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renders with default value', () => {
    render(<DateTimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    expect(button.textContent).toMatch(/\d+, \d{4} \d{1,2}:\d{2} [AP]M/)
  })

  test('renders with provided value', () => {
    const testDate = new Date('2024-01-15T14:30:00.000Z')
    render(<DateTimePicker value={testDate.toISOString()} onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  test('opens picker when button is clicked', () => {
    render(<DateTimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(screen.getByText('Select Date & Time')).toBeInTheDocument()
    expect(screen.getByText('Now')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  test('closes picker when clicking outside', () => {
    render(<DateTimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(screen.getByText('Select Date & Time')).toBeInTheDocument()

    const overlay = document.querySelector('.fixed.inset-0')
    fireEvent.click(overlay!)

    expect(screen.queryByText('Select Date & Time')).not.toBeInTheDocument()
  })

  test('does not call onChange when input changes without clicking OK', () => {
    render(<DateTimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const input = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    fireEvent.change(input, { target: { value: '2024-12-25T15:30' } })

    const overlay = document.querySelector('.fixed.inset-0')
    fireEvent.click(overlay!)

    expect(mockOnChange).not.toHaveBeenCalled()
  })

  test('calls onChange when clicking OK button', () => {
    render(<DateTimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const input = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    fireEvent.change(input, { target: { value: '2024-12-25T15:30' } })

    const okButton = screen.getByText('OK')
    fireEvent.click(okButton)

    expect(mockOnChange).toHaveBeenCalledWith(expect.stringMatching(/2024-12-25T.*:30.*Z/))
  })

  test('calls onChange when clicking Now button', () => {
    render(<DateTimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const nowButton = screen.getByText('Now')
    fireEvent.click(nowButton)

    expect(mockOnChange).toHaveBeenCalledWith(expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/))
  })

  test('resets temp value when reopening picker', async () => {
    render(<DateTimePicker onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    const input = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    const originalValue = input.getAttribute('value')

    fireEvent.change(input, { target: { value: '2024-12-25T15:30' } })
    expect(input.getAttribute('value')).toBe('2024-12-25T15:30')

    const overlay = document.querySelector('.fixed.inset-0')
    fireEvent.click(overlay!)

    fireEvent.click(button)

    await waitFor(() => {
      const newInput = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
      expect(newInput.getAttribute('value')).toBe(originalValue)
    })
  })

  test('displays current value in button text', () => {
    const testDate = new Date('2024-01-15T14:30:00.000Z')
    render(<DateTimePicker value={testDate.toISOString()} onChange={mockOnChange} />)

    const button = screen.getByRole('button')
    expect(button.textContent).toMatch(/January 15, 2024/)
    expect(button.textContent).toMatch(/\d{1,2}:30 [AP]M/)
  })
})
