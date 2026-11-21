import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DatePicker, DatePickerContent, DatePickerLabel, DatePickerTrigger } from '../date-picker'
import {
  DateTimePicker,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from '../date-time-picker'
import { TimePicker, TimePickerContent, TimePickerLabel, TimePickerTrigger } from '../time-picker'

type Kind = 'date' | 'time' | 'date-time'

function Example({ kind, onChange }: { kind: Kind; onChange: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'start', gap: 32 }}>
      <button type="button">Before picker</button>
      {kind === 'date' ? (
        <DatePicker defaultValue="2025-01-15" onValueChange={onChange}>
          <DatePickerLabel>Selection</DatePickerLabel>
          <DatePickerTrigger />
          <DatePickerContent />
        </DatePicker>
      ) : kind === 'time' ? (
        <TimePicker defaultValue="13:30" onValueChange={onChange}>
          <TimePickerLabel>Selection</TimePickerLabel>
          <TimePickerTrigger />
          <TimePickerContent />
        </TimePicker>
      ) : (
        <DateTimePicker
          timeZone="UTC"
          defaultValue={new Date('2025-01-15T13:30:00Z')}
          onValueChange={onChange}
        >
          <DateTimePickerLabel>Selection</DateTimePickerLabel>
          <DateTimePickerTrigger />
          <DateTimePickerContent />
        </DateTimePicker>
      )}
      <button type="button">After picker</button>
    </div>
  )
}

it.each(['date', 'time', 'date-time'] as const)(
  '%s keeps keyboard navigation inside the selection session until explicitly closed',
  async (kind) => {
    const changed = vi.fn()
    const screen = await render(<Example kind={kind} onChange={changed} />)
    await screen.getByRole('button', { name: 'Before picker' }).click()
    await userEvent.tab()
    const trigger = screen.getByRole('button', { name: /^Selection / })
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const selected =
      kind === 'time'
        ? screen.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '1' })
        : screen.getByRole('button', { name: /Wednesday, January 15th, 2025/ })
    await expect.element(selected).toHaveFocus()
    const first =
      kind === 'time'
        ? selected
        : screen.getByRole('button', { name: 'Choose month and year: January 2025' })
    for (let index = 0; index < (kind === 'time' ? 0 : 3); index++) {
      await userEvent.tab({ shift: true })
    }
    await expect.element(first).toHaveFocus()
    await userEvent.tab({ shift: true })
    const last = kind === 'date' ? selected : screen.getByRole('button', { name: 'OK' })
    await expect.element(last).toHaveFocus()
    await userEvent.tab()
    await expect.element(first).toHaveFocus()
    await expect
      .element(screen.getByRole('dialog', { name: 'Selection', exact: true }))
      .toBeVisible()
    expect(changed).not.toHaveBeenCalled()
    const close = screen.getByRole('button', { name: 'Close', exact: true })
    await expect.element(close).toHaveAttribute('tabindex', '-1')
    expect(close.element().getBoundingClientRect().width).toBeLessThanOrEqual(1)
    expect(close.element().getBoundingClientRect().height).toBeLessThanOrEqual(1)
    // Assistive technologies activate this visually hidden control without pointer hit testing.
    const closeButton = close.element() as HTMLButtonElement
    closeButton.click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'After picker' })).toHaveFocus()
    expect(changed).not.toHaveBeenCalled()
  },
)

it.each(['time', 'date-time'] as const)(
  '%s discards time edits through Close and outside press while preserving the clicked focus target',
  async (kind) => {
    const changed = vi.fn()
    const screen = await render(<Example kind={kind} onChange={changed} />)
    const trigger = screen.getByRole('button', { name: /^Selection / })
    for (const dismissal of ['close', 'outside'] as const) {
      await trigger.click()
      if (kind === 'date-time') {
        await screen.getByRole('button', { name: 'Pick Time: 1:30 PM' }).click()
      }
      const hours = screen.getByRole('listbox', { name: 'Hour' })
      await expect.element(hours.getByRole('option', { name: '1' })).toHaveFocus()
      await userEvent.keyboard('{ArrowDown}')
      await expect.element(hours.getByRole('option', { name: '2' })).toHaveFocus()
      if (dismissal === 'close') {
        const closeButton = screen
          .getByRole('button', { name: 'Close', exact: true })
          .element() as HTMLButtonElement
        closeButton.click()
        await expect.element(trigger).toHaveFocus()
      } else {
        await screen.getByText('After picker', { exact: true }).click()
        await expect.element(screen.getByRole('button', { name: 'After picker' })).toHaveFocus()
      }
      await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
      expect(changed).not.toHaveBeenCalled()
    }
    await trigger.click()
    if (kind === 'date-time') {
      await screen.getByRole('button', { name: 'Pick Time: 1:30 PM' }).click()
    }
    await expect
      .element(screen.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '1' }))
      .toHaveFocus()
  },
)

it.each(['date', 'date-time'] as const)(
  '%s traps focus in month/year selection and Close dismisses the entire picker',
  async (kind) => {
    const changed = vi.fn()
    const screen = await render(<Example kind={kind} onChange={changed} />)
    const trigger = screen.getByRole('button', { name: /^Selection / })
    await trigger.click()
    const monthTrigger = screen.getByRole('button', { name: 'Choose month and year: January 2025' })
    await monthTrigger.click()
    const january = screen.getByRole('option', { name: 'January', exact: true })
    await expect.element(january).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect
      .element(screen.getByRole('option', { name: 'February', exact: true }))
      .toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(monthTrigger).toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(screen.getByRole('button', { name: 'OK', exact: true })).toHaveFocus()
    await userEvent.tab()
    await expect.element(monthTrigger).toHaveFocus()
    const closeButton = screen
      .getByRole('button', { name: 'Close', exact: true })
      .element() as HTMLButtonElement
    closeButton.click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(changed).not.toHaveBeenCalled()
    await trigger.click()
    await monthTrigger.click()
    await expect.element(january).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(monthTrigger).toHaveFocus()
    await expect.element(screen.getByRole('grid')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  },
)
