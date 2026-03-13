import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { DatePickerProps } from './types'
import { useState } from 'react'
import { fn } from 'storybook/test'
import DatePicker from './date-picker'
import dayjs, { getDateWithTimezone } from './utils/dayjs'

const meta = {
  title: 'Base/Data Entry/DateAndTimePicker',
  component: DatePicker,
  parameters: {
    docs: {
      description: {
        component: 'Combined date and time picker with timezone support. Includes shortcuts for “now”, year-month navigation, and optional time selection.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    value: getDateWithTimezone({}),
    timezone: dayjs.tz.guess(),
    needTimePicker: true,
    placeholder: 'Select schedule time',
    onChange: fn(),
    onClear: fn(),
  },
} satisfies Meta<typeof DatePicker>

export default meta
type Story = StoryObj<typeof meta>

const DatePickerPlayground = (props: DatePickerProps) => {
  const [value, setValue] = useState(props.value)

  return (
    <div className="inline-flex flex-col items-start gap-3">
      <DatePicker
        popupZIndexClassname="z-50"
        {...props}
        value={value}
        onChange={setValue}
        onClear={() => setValue(undefined)}
      />
      <div className="w-[252px] rounded-lg border border-divider-subtle bg-components-panel-bg p-3 text-xs text-text-secondary">
        Selected datetime:
        {' '}
        <span className="font-mono text-text-primary">{value ? value.format() : 'undefined'}</span>
      </div>
    </div>
  )
}

export const Playground: Story = {
  render: args => <DatePickerPlayground {...args} />,
  args: {
    ...meta.args,
    needTimePicker: false,
    placeholder: 'Select due date',
  },
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
const [value, setValue] = useState(getDateWithTimezone({}))

<DatePicker
  popupZIndexClassname="z-50"
  value={value}
  timezone={dayjs.tz.guess()}
  onChange={setValue}
  onClear={() => setValue(undefined)}
/>
        `.trim(),
      },
    },
  },
}

export const DateOnly: Story = {
  render: args => (
    <DatePickerPlayground
      {...args}
      needTimePicker={false}
      placeholder="Select due date"
    />
  ),
  args: {
    ...meta.args,
    needTimePicker: false,
    placeholder: 'Select due date',
  },
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<DatePicker needTimePicker={false} placeholder="Select due date" />
        `.trim(),
      },
    },
  },
}
