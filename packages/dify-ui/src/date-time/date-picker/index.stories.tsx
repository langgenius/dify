import type { Meta, StoryObj } from '@storybook/react-vite'
import { arTN } from '@daypicker/react/locale/ar-TN'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import { Button } from '../../button'
import { DirectionProvider } from '../../direction-provider'
import { Field, FieldDescription, FieldError } from '../../field'
import { Form } from '../../form'
import {
  DateTimePicker,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from '../date-time-picker'
import { TimePicker, TimePickerContent, TimePickerLabel, TimePickerTrigger } from '../time-picker'
import {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from './index'

const meta = {
  title: 'Base/Form/Date Picker',
  component: DatePicker,
  args: { children: null },
  parameters: {
    layout: 'centered',
    docs: { story: { autoplay: false } },
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DatePicker>

export default meta
type Story = StoryObj<typeof meta>

function DatePickerDemo() {
  const [value, setValue] = React.useState<string | null>('2025-01-15')
  return (
    <div className="grid gap-1">
      <DatePicker value={value} onValueChange={setValue}>
        <DatePickerLabel>Start date</DatePickerLabel>
        <div className="flex items-center gap-1">
          <DatePickerTrigger />
          <DatePickerClear aria-label="Clear start date" />
        </div>
        <DatePickerContent />
      </DatePicker>
    </div>
  )
}

export const Default: Story = {
  render: () => <DatePickerDemo />,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'Start date Jan 15, 2025' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await waitFor(() =>
      expect(body.getByRole('button', { name: /Wednesday, January 15th, 2025/ })).toHaveFocus(),
    )
    await userEvent.keyboard('{ArrowRight}{Enter}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(trigger).toHaveAccessibleName('Start date Jan 16, 2025')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
}

function NativeFormDemo() {
  const id = React.useId()
  const [submitted, setSubmitted] = React.useState<Record<string, FormDataEntryValue> | null>(null)
  return (
    <form
      aria-label="Schedule"
      className="grid w-80 max-w-full gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(Object.fromEntries(new FormData(event.currentTarget)))
      }}
      onReset={() => setSubmitted(null)}
    >
      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-2 system-md-semibold text-text-primary">Schedule</legend>
        <div className="grid gap-1">
          <DatePicker name="date" required validationMessage="Choose a start date.">
            <DatePickerLabel>Start date (required)</DatePickerLabel>
            <DatePickerTrigger aria-describedby={`${id}-date-help`} />
            <DatePickerContent />
          </DatePicker>
          <p id={`${id}-date-help`} className="system-xs-regular text-text-secondary">
            Choose a calendar date; no time zone is stored.
          </p>
        </div>
        <div className="grid gap-1">
          <TimePicker name="time" defaultValue="13:30">
            <TimePickerLabel>Start time</TimePickerLabel>
            <TimePickerTrigger />
            <TimePickerContent />
          </TimePicker>
        </div>
        <div className="grid gap-1">
          <DateTimePicker
            name="reminder"
            timeZone="UTC"
            defaultValue={new Date('2025-01-15T13:30:00Z')}
          >
            <DateTimePickerLabel>Reminder (UTC)</DateTimePickerLabel>
            <DateTimePickerTrigger />
            <DateTimePickerContent />
          </DateTimePicker>
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit">Save</Button>
        <Button type="reset" variant="secondary">
          Reset
        </Button>
      </div>
      {submitted && (
        <output aria-label="Submitted values" className="system-xs-regular break-all">
          {JSON.stringify(submitted)}
        </output>
      )}
    </form>
  )
}

export const NativeForm: Story = {
  render: () => <NativeFormDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Native form, fieldset, picker labels and FormData. Labels focus their triggers without opening the popup; descriptions and committed values are announced with the visible label. Save validates the required date, and Reset restores defaults. No Base UI Field or Form registration is involved.',
      },
    },
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'Start date (required)' })
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(canvas.queryByRole('status', { name: 'Submitted values' })).not.toBeInTheDocument()
    await expect(trigger).toHaveFocus()
    await expect(trigger).toHaveAttribute('aria-invalid', 'true')
    await expect(trigger).toHaveAccessibleDescription(
      /Choose a calendar date; no time zone is stored.*Choose a start date/,
    )
    for (const [label, name] of [
      ['Start date (required)', 'Start date (required)'],
      ['Start time', /^Start time\b/],
      ['Reminder (UTC)', /^Reminder \(UTC\)/],
    ] as const) {
      await userEvent.click(canvas.getByText(label, { exact: true }))
      const field = canvas.getByRole('button', { name })
      await expect(field).toHaveFocus()
      await expect(field).toHaveAttribute('aria-expanded', 'false')
      await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    }
    await userEvent.click(canvas.getByText('Start date (required)', { exact: true }))
    await userEvent.keyboard('{Enter}')
    const dialog = await body.findByRole('dialog', { name: 'Start date (required)' })
    await waitFor(() => expect(dialog).toBeVisible())
    await waitFor(() =>
      expect(dialog.contains(canvasElement.ownerDocument.activeElement)).toBe(true),
    )
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    const submitted = canvas.getByRole('status', { name: 'Submitted values' })
    const values = JSON.parse(submitted.textContent!)
    await expect(values).toEqual({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      time: '13:30',
      reminder: '2025-01-15T13:30:00.000Z',
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(trigger).toHaveAccessibleName('Start date (required)'))
    await expect(trigger).not.toHaveAttribute('aria-invalid', 'true')
    await expect(canvas.queryByRole('status', { name: 'Submitted values' })).not.toBeInTheDocument()
  },
}

export const Empty: Story = {
  render: () => (
    <DatePicker>
      <DatePickerLabel className="sr-only">Start date</DatePickerLabel>
      <DatePickerTrigger />
      <DatePickerContent />
    </DatePicker>
  ),
}
export const Disabled: Story = {
  render: () => (
    <DatePicker defaultValue="2025-01-15" disabled>
      <DatePickerLabel className="sr-only">Start date</DatePickerLabel>
      <DatePickerTrigger />
      <DatePickerClear aria-label="Clear start date" />
      <DatePickerContent />
    </DatePicker>
  ),
}
export const ReadOnly: Story = {
  render: () => (
    <DatePicker defaultValue="2025-01-15" readOnly>
      <DatePickerLabel className="sr-only">Start date</DatePickerLabel>
      <DatePickerTrigger />
      <DatePickerContent />
    </DatePicker>
  ),
}

export const Calendar: Story = {
  ...Default,
  name: 'Calendar (open preview)',
  tags: ['!autodocs'],
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Start date Jan 15, 2025' }),
    )
    const grid = await within(canvasElement.ownerDocument.body).findByRole('grid')
    await waitFor(() => expect(grid).toBeVisible())
  },
}

export const RTL: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'DirectionProvider supplies interaction direction; dir sets the surrounding HTML direction. The picker carries direction into its portaled popup. Calendar dates use the Arabic locale; action labels retain the English defaults.',
      },
    },
  },
  render: () => (
    <div dir="rtl">
      <DirectionProvider direction="rtl">
        <DatePicker locale={arTN} defaultValue="2025-01-15">
          <DatePickerLabel className="sr-only">Start date</DatePickerLabel>
          <DatePickerTrigger />
          <DatePickerContent />
        </DatePicker>
      </DirectionProvider>
    </div>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = within(canvasElement).getByRole('button', { name: /^Start date / })
    await userEvent.click(trigger)
    const dialog = await body.findByRole('dialog', { name: 'Start date' })
    await expect(dialog).toHaveAttribute('dir', 'rtl')
    await waitFor(() =>
      expect(body.getByRole('button', { name: /^الأربعاء، 15 جانفي 2025/ })).toHaveFocus(),
    )
    await userEvent.keyboard('{ArrowLeft}')
    await expect(body.getByRole('button', { name: 'الخميس، 16 جانفي 2025' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(body.getByRole('button', { name: /^الأربعاء، 15 جانفي 2025/ })).toHaveFocus()
    const heading = body.getByRole('button', { name: /Choose month and year:/ })
    await userEvent.click(heading)
    const months = await body.findByRole('listbox', { name: 'Month' })
    const years = body.getByRole('listbox', { name: 'Year' })
    await expect(months.getBoundingClientRect().left).toBeGreaterThan(
      years.getBoundingClientRect().left,
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(body.getByRole('button', { name: /Choose month and year:/ })).toHaveFocus(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(body.getByRole('grid')).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

function FieldFormExample() {
  const [submitted, setSubmitted] = React.useState('')
  const [lastChange, setLastChange] = React.useState('No committed changes')
  return (
    <Form
      className="grid w-80 gap-4"
      onFormSubmit={(values) => setSubmitted(JSON.stringify(values))}
      onReset={() => setSubmitted('')}
    >
      <Field name="departureDate">
        <DatePicker
          required
          minDate="2025-01-01"
          maxDate="2025-01-31"
          onValueChange={(_value, details) => setLastChange(`Date: ${details.reason}`)}
        >
          <DatePickerLabel>Departure date</DatePickerLabel>
          <div className="flex items-center gap-1">
            <DatePickerTrigger />
            <DatePickerClear aria-label="Clear departure date" />
          </div>
          <DatePickerContent />
        </DatePicker>
        <FieldDescription>Choose a date in January 2025.</FieldDescription>
        <FieldError match="valueMissing">Choose a departure date.</FieldError>
      </Field>
      <Field name="departureTime">
        <TimePicker
          defaultValue="13:30"
          onValueChange={(_value, details) => setLastChange(`Time: ${details.reason}`)}
        >
          <TimePickerLabel>Departure time</TimePickerLabel>
          <TimePickerTrigger />
          <TimePickerContent />
        </TimePicker>
        <FieldDescription>Changes are committed with OK.</FieldDescription>
        <FieldError />
      </Field>
      <Field name="meetingInstant">
        <DateTimePicker
          timeZone="America/New_York"
          defaultValue={new Date('2025-01-15T18:30:00Z')}
          onValueChange={(_value, details) => setLastChange(`Meeting: ${details.reason}`)}
        >
          <DateTimePickerLabel>Meeting in New York</DateTimePickerLabel>
          <DateTimePickerTrigger />
          <DateTimePickerContent />
        </DateTimePicker>
        <FieldDescription>Submitted as a UTC instant.</FieldDescription>
        <FieldError />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Submit booking
        </Button>
        <Button type="reset" variant="secondary">
          Reset booking
        </Button>
      </div>
      <output aria-label="Last change" className="system-xs-regular text-text-secondary">
        {lastChange}
      </output>
      <output
        aria-label="Submitted values"
        className="system-xs-regular break-all text-text-secondary"
      >
        {submitted}
      </output>
    </Form>
  )
}

export const FieldAndForm: Story = {
  render: () => <FieldFormExample />,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Submit booking' }))
    await expect(canvas.getByText('Choose a departure date.')).toBeVisible()
    const trigger = canvas.getByRole('button', { name: 'Departure date' })
    await expect(trigger).toHaveFocus()
    await userEvent.click(trigger)
    await userEvent.click(
      await page.findByRole('button', { name: 'Wednesday, January 15th, 2025' }),
    )
    await expect(canvas.getByLabelText('Last change')).toHaveTextContent('Date: item-press')
    await userEvent.click(canvas.getByRole('button', { name: 'Departure time 1:30 PM' }))
    await userEvent.click(
      within(page.getByRole('listbox', { name: 'Hour' })).getByRole('option', {
        name: '2',
      }),
    )
    await userEvent.click(page.getByRole('button', { name: 'OK' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Submit booking' }))
    await expect(canvas.getByLabelText('Submitted values')).toHaveTextContent(
      '{"departureDate":"2025-01-15","departureTime":"14:30","meetingInstant":"2025-01-15T18:30:00.000Z"}',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Reset booking' }))
    await expect(canvas.getByRole('button', { name: 'Departure date' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Departure time 1:30 PM' })).toBeVisible()
    await expect(canvas.queryByText('Choose a departure date.')).not.toBeInTheDocument()
  },
}
