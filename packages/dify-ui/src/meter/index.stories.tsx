import type { Meta, StoryObj } from '@storybook/react-vite'
import { getThresholdTone, Meter, MeterIndicator, MeterLabel, MeterRoot, MeterTrack, MeterValue } from '.'

const meta = {
  title: 'Base/UI/Meter',
  component: Meter,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A graphical display of a numeric value within a known range. '
          + 'Use for quota, capacity, or score indicators; do not use for '
          + 'task-completion progress (that belongs on a Progress primitive).',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: { control: 'number' },
    min: { control: 'number' },
    max: { control: 'number' },
    tone: {
      control: 'inline-radio',
      options: ['neutral', 'warning', 'error'],
    },
  },
} satisfies Meta<typeof Meter>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    'value': 42,
    'max': 100,
    'tone': 'neutral',
    'aria-label': 'Quota used',
  },
  render: args => (
    <div className="w-[320px]">
      <Meter {...args} />
    </div>
  ),
}

export const Warning: Story = {
  args: {
    'value': 85,
    'max': 100,
    'tone': 'warning',
    'aria-label': 'Quota used',
  },
  render: args => (
    <div className="w-[320px]">
      <Meter {...args} />
    </div>
  ),
}

export const Error: Story = {
  args: {
    'value': 100,
    'max': 100,
    'tone': 'error',
    'aria-label': 'Quota used',
  },
  render: args => (
    <div className="w-[320px]">
      <Meter {...args} />
    </div>
  ),
}

export const AutoToneFromThreshold: Story = {
  args: {
    'value': 87,
    'max': 100,
    'aria-label': 'Vector space usage',
  },
  render: (args) => {
    const percent = (args.value / (args.max ?? 100)) * 100
    return (
      <div className="w-[320px]">
        <Meter {...args} tone={getThresholdTone(percent)} />
        <div className="mt-2 text-center system-xs-regular text-text-tertiary">
          {percent.toFixed(0)}
          %
        </div>
      </div>
    )
  },
}

export const ComposedWithLabelAndValue: Story = {
  args: {
    'value': 62,
    'max': 100,
    'aria-label': 'Storage used',
  },
  render: args => (
    <div className="w-[320px] space-y-2 rounded-xl bg-components-panel-bg p-4">
      <MeterRoot
        value={args.value}
        min={args.min}
        max={args.max}
        aria-label={args['aria-label']}
      >
        <div className="flex items-center justify-between">
          <MeterLabel>Storage</MeterLabel>
          <MeterValue />
        </div>
        <MeterTrack className="mt-2">
          <MeterIndicator tone="warning" />
        </MeterTrack>
      </MeterRoot>
    </div>
  ),
}

export const PercentFormatted: Story = {
  args: {
    'value': 0.73,
    'min': 0,
    'max': 1,
    'format': { style: 'percent', maximumFractionDigits: 0 },
    'aria-label': 'Retrieval score',
  },
  render: args => (
    <div className="w-[320px] space-y-2">
      <MeterRoot
        value={args.value}
        min={args.min}
        max={args.max}
        format={args.format}
        aria-label={args['aria-label']}
      >
        <div className="flex items-center justify-between">
          <MeterLabel>Score</MeterLabel>
          <MeterValue />
        </div>
        <MeterTrack className="mt-2">
          <MeterIndicator tone="neutral" />
        </MeterTrack>
      </MeterRoot>
    </div>
  ),
}
