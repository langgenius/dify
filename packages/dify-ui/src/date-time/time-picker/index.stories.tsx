import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import { DirectionProvider } from '../../direction-provider'
import {
  TimePicker,
  TimePickerClear,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
  TimePickerValue,
} from './index'

const meta = {
  title: 'Base/Form/Time Picker',
  component: TimePicker,
  args: { children: null },
  parameters: {
    layout: 'centered',
    docs: { story: { autoplay: false } },
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TimePicker>

export default meta
type Story = StoryObj<typeof meta>

function TimePickerDemo() {
  const [value, setValue] = React.useState<string | null>('13:30')
  return (
    <div className="grid gap-1">
      <TimePicker value={value} onValueChange={setValue}>
        <TimePickerLabel>Start time</TimePickerLabel>
        <div className="flex items-center gap-1">
          <TimePickerTrigger />
          <TimePickerClear aria-label="Clear start time" />
        </div>
        <TimePickerContent />
      </TimePicker>
    </div>
  )
}

export const Default: Story = {
  render: () => <TimePickerDemo />,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'Start time 1:30 PM' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    let hours = within(await body.findByRole('listbox', { name: 'Hour' }))
    await waitFor(() => expect(hours.getByRole('option', { name: '1' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(trigger).toHaveAccessibleName('Start time 1:30 PM')
    await userEvent.keyboard('{Enter}')
    hours = within(await body.findByRole('listbox', { name: 'Hour' }))
    await waitFor(() => expect(hours.getByRole('option', { name: '1' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    await expect(hours.getByRole('option', { name: '2' })).toHaveFocus()
    await expect(hours.getByRole('option', { name: '2' })).toHaveAttribute('aria-selected', 'true')
    await expect(trigger).toHaveAccessibleName('Start time 1:30 PM')
    await userEvent.click(body.getByRole('button', { name: 'OK' }))
    const updatedTrigger = canvas.getByRole('button', { name: 'Start time 2:30 PM' })
    await waitFor(() => expect(updatedTrigger).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    const dialog = await body.findByRole('dialog', { name: 'Start time' })
    await waitFor(() => expect(dialog).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(updatedTrigger).toHaveFocus())
  },
}

export const RTL: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'RTL reverses column placement, not vertical navigation. Arrow and Page keys stop at the endpoints; Home/End and numeric typing provide quick positioning. Escape discards the draft. Formatting locale remains independent of direction.',
      },
    },
  },
  render: () => (
    <div dir="rtl">
      <DirectionProvider direction="rtl">
        <TimePickerDemo />
      </DirectionProvider>
    </div>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = within(canvasElement).getByRole('button', { name: 'Start time 1:30 PM' })
    await userEvent.click(trigger)
    await expect(await body.findByRole('dialog', { name: 'Start time' })).toHaveAttribute(
      'dir',
      'rtl',
    )
    const hours = body.getByRole('listbox', { name: 'Hour' })
    const minutes = body.getByRole('listbox', { name: 'Minute' })
    await waitFor(() => expect(within(hours).getByRole('option', { name: '1' })).toHaveFocus())
    await expect(hours.getBoundingClientRect().left).toBeGreaterThan(
      minutes.getBoundingClientRect().left,
    )
    await userEvent.tab()
    await expect(within(minutes).getByRole('option', { name: '30' })).toHaveFocus()
    await userEvent.keyboard('{Home}{ArrowUp}{PageUp}')
    await expect(within(minutes).getByRole('option', { name: '00' })).toHaveFocus()
    await userEvent.keyboard('{End}{ArrowDown}{PageDown}')
    const last = within(minutes).getByRole('option', { name: '59' })
    await expect(last).toHaveFocus()
    await expect(last).toHaveAttribute('aria-selected', 'true')
    await userEvent.tab()
    await expect(
      within(body.getByRole('listbox', { name: 'Period' })).getByRole('option', { name: 'PM' }),
    ).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(trigger).toHaveAccessibleName('Start time 1:30 PM')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(body.getByRole('dialog', { name: 'Start time' })).toBeVisible())
    await expect(
      within(body.getByRole('listbox', { name: 'Minute' })).getByRole('option', { name: '30' }),
    ).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const UnavailableTime: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Unavailable combinations can be explored but cannot be confirmed. Change another column to reach a valid time; only OK commits the draft.',
      },
    },
  },
  render: () => (
    <TimePicker defaultValue="09:00" isTimeUnavailable={(time) => time === '10:00'}>
      <TimePickerLabel className="sr-only">Start time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Start time 9:00 AM' }))
    await userEvent.click(
      within(await body.findByRole('listbox', { name: 'Hour' })).getByRole('option', {
        name: '10',
      }),
    )
    await expect(body.getByRole('button', { name: 'OK' })).toBeDisabled()
    await expect(body.getByRole('status')).toHaveTextContent('This date or time is unavailable.')
  },
}

export const Schedule: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A 24-hour schedule with quarter-hour steps and a composed value. The time zone determines Now, not the stored HH:mm wall time. Keep meaningful suffixes inside Value so they are included in the trigger name.',
      },
    },
  },
  render: () => (
    <div className="grid gap-1">
      <TimePicker defaultValue="13:30" hourCycle={24} minuteStep={15} timeZone="UTC">
        <TimePickerLabel>Update time</TimePickerLabel>
        <TimePickerTrigger>
          <TimePickerValue>
            {(value) => (
              <React.Fragment>
                {value} <span className="text-text-tertiary">UTC+0</span>
              </React.Fragment>
            )}
          </TimePickerValue>
        </TimePickerTrigger>
        <TimePickerContent />
      </TimePicker>
    </div>
  ),
}
