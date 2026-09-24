import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    expect(screen.getByRole('button', { name: 'Select date: May 1, 2024' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('opens from the keyboard and restores focus to the date button on dismissal', async () => {
    const user = userEvent.setup()
    render(<ToolDatePicker value="2024-05-01" onChange={vi.fn()} timezone="UTC" />)

    const trigger = screen.getByRole('button', { name: 'Select date: May 1, 2024' })
    expect(within(trigger).queryByRole('button')).not.toBeInTheDocument()
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('lets the keyboard reach and activate clear without opening the calendar', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToolDatePicker value="2024-05-01" onChange={onChange} timezone="UTC" />)

    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
