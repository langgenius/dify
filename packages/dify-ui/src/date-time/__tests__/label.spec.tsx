import type * as React from 'react'
import {
  DatePicker,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from '@langgenius/dify-ui/date-picker'
import {
  DateTimePicker,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from '@langgenius/dify-ui/date-time-picker'
import {
  TimePicker,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
} from '@langgenius/dify-ui/time-picker'
import { createPortal } from 'react-dom'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'

const pickers = [
  {
    name: 'DatePicker',
    wrap: (children: React.ReactNode) => <DatePicker label="Date">{children}</DatePicker>,
    Label: DatePickerLabel,
    Trigger: DatePickerTrigger,
    Content: DatePickerContent,
  },
  {
    name: 'TimePicker',
    wrap: (children: React.ReactNode) => <TimePicker label="Time">{children}</TimePicker>,
    Label: TimePickerLabel,
    Trigger: TimePickerTrigger,
    Content: TimePickerContent,
  },
  {
    name: 'DateTimePicker',
    wrap: (children: React.ReactNode) => (
      <DateTimePicker label="Meeting" timeZone="UTC">
        {children}
      </DateTimePicker>
    ),
    Label: DateTimePickerLabel,
    Trigger: DateTimePickerTrigger,
    Content: DateTimePickerContent,
  },
]

it.each(pickers)(
  '$name label focuses only from its text and preserves a nested action',
  async ({ wrap, Label, Trigger, Content }) => {
    const help = vi.fn()
    const screen = await render(
      wrap(
        <>
          <Label>
            <span>Departure</span>
            <button type="button" onClick={help}>
              <span>Help</span>
            </button>
          </Label>
          <Trigger />
          <Content />
        </>,
      ),
    )
    const trigger = screen.getByRole('button', { name: 'Departure Help' })
    await screen.getByText('Departure', { exact: true }).click()
    await expect.element(trigger).toHaveFocus()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')

    const action = screen.getByRole('button', { name: 'Help', exact: true })
    await screen.getByText('Help', { exact: true }).click()
    await expect.element(action).toHaveFocus()
    expect(help).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Enter}')
    expect(help).toHaveBeenCalledTimes(2)
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()

    await userEvent.tab()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('dialog')).toBeInTheDocument()
  },
)

it('preserves native focus and typing in label children', async () => {
  const screen = await render(
    <DatePicker label="Date">
      <DatePickerLabel>
        Departure
        <a href="https://example.com/help" onClick={(event) => event.preventDefault()}>
          Help
        </a>
        <input aria-label="Note" />
      </DatePickerLabel>
      <DatePickerTrigger />
      <DatePickerContent />
    </DatePicker>,
  )
  const link = screen.getByRole('link', { name: 'Help' })
  await link.click()
  await expect.element(link).toHaveFocus()
  const input = screen.getByRole('textbox', { name: 'Note' })
  await input.click()
  await expect.element(input).toHaveFocus()
  await userEvent.keyboard('Booking')
  await expect.element(input).toHaveValue('Booking')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('does not forward clicks from portalled label content to the trigger', async () => {
  const screen = await render(
    <DatePicker label="Date">
      <DatePickerLabel>
        Departure
        {createPortal(<input aria-label="Help search" />, document.body)}
      </DatePickerLabel>
      <DatePickerTrigger />
      <DatePickerContent />
    </DatePicker>,
  )
  const input = screen.getByRole('textbox', { name: 'Help search' })
  await input.click()
  await expect.element(input).toHaveFocus()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('allows a consumer to cancel label focus forwarding', async () => {
  const screen = await render(
    <>
      <button type="button">Previous control</button>
      <DatePicker label="Date">
        <DatePickerLabel onClick={(event) => event.preventDefault()}>Departure</DatePickerLabel>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>
    </>,
  )
  const previous = screen.getByRole('button', { name: 'Previous control' })
  await previous.click()
  await screen.getByText('Departure', { exact: true }).click()
  await expect.element(previous).toHaveFocus()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})
