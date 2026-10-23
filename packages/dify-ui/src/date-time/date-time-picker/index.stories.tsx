import type { Meta, StoryObj } from '@storybook/react-vite'
import { arTN } from '@daypicker/react/locale/ar-TN'
import { faIR } from '@daypicker/react/locale/fa-IR'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  DateTimePicker,
  DateTimePickerClear,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from './index'

const meta = {
  title: 'Base/Form/Date Time Picker',
  component: DateTimePicker,
  args: {
    timeZone: 'UTC',
    children: null,
  },
  parameters: {
    layout: 'centered',
    docs: { story: { autoplay: false } },
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DateTimePicker>

export default meta
type Story = StoryObj<typeof meta>

function DateTimePickerDemo({ timeZone = 'UTC' }: { timeZone?: string }) {
  const [value, setValue] = React.useState<Date | null>(() => new Date('2025-01-15T13:30:00Z'))
  return (
    <div className="grid gap-1">
      <DateTimePicker timeZone={timeZone} value={value} onValueChange={setValue}>
        <DateTimePickerLabel>Meeting time</DateTimePickerLabel>
        <div className="flex items-center gap-1">
          <DateTimePickerTrigger />
          <DateTimePickerClear aria-label="Clear meeting time" />
        </div>
        <DateTimePickerContent />
      </DateTimePicker>
    </div>
  )
}

export const Default: Story = {
  render: () => <DateTimePickerDemo />,
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = within(canvasElement).getByRole('button', {
      name: 'Meeting time Jan 15, 2025, 1:30 PM',
    })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await userEvent.click(await body.findByRole('button', { name: 'Thursday, January 16th, 2025' }))
    await expect(trigger).toHaveAccessibleName('Meeting time Jan 15, 2025, 1:30 PM')
    await userEvent.click(body.getByRole('button', { name: /Pick Time:/ }))
    const hours = within(await body.findByRole('listbox', { name: 'Hour' }))
    await waitFor(() => expect(hours.getByRole('option', { name: '1' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(body.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(trigger).toHaveAccessibleName('Meeting time Jan 16, 2025, 2:30 PM')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
}

export const RTL: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A local direction override applies to both calendar and time views, including the portaled popup. Dates use Arabic formatting with English action labels. Changing views preserves the draft; Escape discards it.',
      },
    },
  },
  render: () => (
    <DateTimePicker
      direction="rtl"
      locale={arTN}
      timeZone="Asia/Shanghai"
      defaultValue={new Date('2025-01-15T13:30:00Z')}
      hourCycle={24}
    >
      <DateTimePickerLabel className="sr-only">Meeting time</DateTimePickerLabel>
      <DateTimePickerTrigger />
      <DateTimePickerContent />
    </DateTimePicker>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = within(canvasElement).getByRole('button', { name: /^Meeting time / })
    await userEvent.click(trigger)
    await expect(await body.findByRole('dialog', { name: 'Meeting time' })).toHaveAttribute(
      'dir',
      'rtl',
    )
    await userEvent.click(body.getByRole('button', { name: /Pick Time:/ }))
    const hours = await body.findByRole('listbox', { name: 'Hour' })
    const minutes = body.getByRole('listbox', { name: 'Minute' })
    await expect(hours.getBoundingClientRect().left).toBeGreaterThan(
      minutes.getBoundingClientRect().left,
    )
    await waitFor(() => expect(within(hours).getByRole('option', { name: '21' })).toHaveFocus())
    await userEvent.keyboard('{End}{ArrowDown}')
    await expect(within(hours).getByRole('option', { name: '23' })).toHaveFocus()
    await userEvent.click(body.getByRole('button', { name: 'Pick Date' }))
    await waitFor(() => expect(body.getByRole('grid')).toBeVisible())
    await userEvent.click(body.getByRole('button', { name: /Pick Time:/ }))
    await waitFor(() =>
      expect(
        within(body.getByRole('listbox', { name: 'Hour' })).getByRole('option', { name: '23' }),
      ).toHaveFocus(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await userEvent.click(await body.findByRole('button', { name: /Pick Time:/ }))
    await waitFor(() =>
      expect(
        within(body.getByRole('listbox', { name: 'Hour' })).getByRole('option', { name: '21' }),
      ).toHaveFocus(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const NewYork: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'This example displays dates and Now in America/New_York, independently of your browser time zone.',
      },
    },
  },
  render: () => <DateTimePickerDemo timeZone="America/New_York" />,
}

export const Calendar = {
  render: () => <DateTimePickerDemo />,
  name: 'Calendar (open preview)',
  tags: ['!autodocs'],
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Meeting time / }))
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Meeting time',
    })
    await waitFor(() => expect(dialog).toBeVisible())
  },
} satisfies Story
export const ConstrainedHeight: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'An explicit 210px maxHeight opts into scrolling for the calendar and individual columns while keeping confirmation actions visible. Normal content uses its natural height; this is not the mobile default.',
      },
    },
  },
  render: () => (
    <DateTimePicker timeZone="UTC" defaultValue={new Date('2025-01-15T13:30:00Z')}>
      <DateTimePickerLabel className="sr-only">Meeting time</DateTimePickerLabel>
      <DateTimePickerTrigger />
      <DateTimePickerContent style={{ maxHeight: 210 }} />
    </DateTimePicker>
  ),
}

export const Time: Story = {
  ...Calendar,
  name: 'Time (open preview)',
  play: async (context) => {
    await Calendar.play(context)
    const { canvasElement, userEvent } = context
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('button', { name: /Pick Time:/ }),
    )
  },
}
export const MonthAndYear: Story = {
  ...Calendar,
  name: 'Month and year (open preview)',
  play: async (context) => {
    await Calendar.play(context)
    const { canvasElement, userEvent } = context
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('button', {
        name: /Choose month and year:/,
      }),
    )
  },
}
export const PersianNumbers: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Persian numerals across calendar, year and time columns. Native and ASCII digits both locate options. Values remain Gregorian and serialize independently of locale. Action labels use the English defaults; locale does not translate application copy.',
      },
    },
  },
  render: () => (
    <div dir="rtl" className="grid gap-1">
      <DateTimePicker
        locale={faIR}
        direction="rtl"
        timeZone="UTC"
        hourCycle={24}
        defaultValue={new Date('2025-01-15T10:05:00Z')}
      >
        <DateTimePickerLabel>Meeting</DateTimePickerLabel>
        <DateTimePickerTrigger />
        <DateTimePickerContent />
      </DateTimePicker>
    </div>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Meeting / }))
    const dialog = await body.findByRole('dialog', { name: 'Meeting' })
    await waitFor(() => expect(within(dialog).getByRole('grid')).toBeVisible())
  },
}
