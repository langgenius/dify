import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import ToolDatePicker from '../tool-date-picker'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock({
      'time.dateFormats.display': 'MMMM D, YYYY',
      'time.operation.pickDate': 'Select date',
      'common.operation.clear': 'Clear',
    }),
  }
})

describe('ToolDatePicker', () => {
  it('preserves a stored date-only value when rendering in a negative timezone', () => {
    render(
      <ToolDatePicker
        value="2024-05-01"
        onChange={vi.fn()}
        timezone="America/Los_Angeles"
        placeholder="Select date"
      />,
    )

    expect(screen.getByRole('button', { name: 'Select date: May 1, 2024' })).toBeInTheDocument()
  })

  it('returns an empty string when clearing the date', () => {
    const onChange = vi.fn()
    render(
      <ToolDatePicker
        value="2024-05-01"
        onChange={onChange}
        timezone="UTC"
        placeholder="Select date"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('disables interaction and clearing when read only', () => {
    render(
      <ToolDatePicker
        value="2024-05-01"
        onChange={vi.fn()}
        timezone="UTC"
        placeholder="Select date"
        readOnly
      />,
    )

    expect(screen.getByRole('button', { name: 'Select date: May 1, 2024' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })
})
