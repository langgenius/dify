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
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'

const pickers = [
  {
    name: 'DatePicker',
    wrap: (children: React.ReactNode) => <DatePicker>{children}</DatePicker>,
    Label: DatePickerLabel,
    Trigger: DatePickerTrigger,
    Content: DatePickerContent,
  },
  {
    name: 'TimePicker',
    wrap: (children: React.ReactNode) => <TimePicker>{children}</TimePicker>,
    Label: TimePickerLabel,
    Trigger: TimePickerTrigger,
    Content: TimePickerContent,
  },
  {
    name: 'DateTimePicker',
    wrap: (children: React.ReactNode) => <DateTimePicker timeZone="UTC">{children}</DateTimePicker>,
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
        <React.Fragment>
          <Label>
            <span>Departure</span>
            <button type="button" onClick={help}>
              <span>Help</span>
            </button>
          </Label>
          <Trigger />
          <Content />
        </React.Fragment>,
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
    await expect.element(screen.getByRole('dialog', { name: 'Departure Help' })).toBeInTheDocument()
  },
)

it('preserves native focus and typing in label children', async () => {
  const screen = await render(
    <DatePicker>
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
    <DatePicker>
      <DatePickerLabel>
        Departure
        {ReactDOM.createPortal(<input aria-label="Help search" />, document.body)}
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
    <React.Fragment>
      <button type="button">Previous control</button>
      <DatePicker>
        <DatePickerLabel onClick={(event) => event.preventDefault()}>Departure</DatePickerLabel>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>
    </React.Fragment>,
  )
  const previous = screen.getByRole('button', { name: 'Previous control' })
  await previous.click()
  await screen.getByText('Departure', { exact: true }).click()
  await expect.element(previous).toHaveFocus()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it.each(pickers)(
  '$name supports explicitly named parts without a Label',
  async ({ wrap, Trigger, Content }) => {
    const screen = await render(
      wrap(
        <React.Fragment>
          <Trigger aria-label="Departure" />
          <Content aria-label="Choose departure" />
        </React.Fragment>,
      ),
    )
    const trigger = screen.getByRole('button', { name: 'Departure' })
    await trigger.click()
    await expect.element(screen.getByRole('dialog', { name: 'Choose departure' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveFocus()
  },
)

it('combines external label, value and descriptions without losing validation feedback', async () => {
  const screen = await render(
    <React.Fragment>
      <span id="departure-label">Departure</span>
      <p id="departure-help">Choose a working day.</p>
      <DatePicker
        defaultValue="2025-01-15"
        required
        invalid
        validationMessage="This date is unavailable."
      >
        <DatePickerTrigger aria-labelledby="departure-label" aria-describedby="departure-help" />
        <DatePickerContent aria-labelledby="departure-label" />
      </DatePicker>
    </React.Fragment>,
  )
  const trigger = screen.getByRole('button', { name: 'Departure Jan 15, 2025' })
  await expect
    .element(trigger)
    .toHaveAccessibleDescription('Choose a working day. Required This date is unavailable.')
  await trigger.click()
  await expect.element(screen.getByRole('dialog', { name: 'Departure' })).toBeVisible()
})

it('honors explicit names when a Label is also composed', async () => {
  const screen = await render(
    <DatePicker defaultValue="2025-01-15">
      <DatePickerLabel>Departure</DatePickerLabel>
      <DatePickerTrigger aria-label="Departure date" />
      <DatePickerContent aria-label="Choose departure date" />
    </DatePicker>,
  )
  await screen.getByRole('button', { name: 'Departure date' }).click()
  await expect.element(screen.getByRole('dialog', { name: 'Choose departure date' })).toBeVisible()
})
