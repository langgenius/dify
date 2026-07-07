import type { Meta, StoryObj } from '@storybook/react-vite'
import { MeterIndicator, MeterLabel, MeterRoot, MeterTrack, MeterValue } from '.'

const meta = {
  title: 'Base/UI/Meter',
  component: MeterRoot,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A graphical display of a numeric value within a known range. '
          + 'Use the compound primitives (`MeterRoot / MeterTrack / MeterIndicator / '
          + 'MeterValue / MeterLabel`) for quota, capacity, or score indicators; do '
          + 'not use for task-completion progress.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof MeterRoot>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    'value': 42,
    'aria-label': 'Quota used',
  },
  render: args => (
    <div className="w-[320px]">
      <MeterRoot {...args}>
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      </MeterRoot>
    </div>
  ),
}

export const Warning: Story = {
  args: {
    'value': 85,
    'aria-label': 'Quota used',
  },
  render: args => (
    <div className="w-[320px]">
      <MeterRoot {...args}>
        <MeterTrack>
          <MeterIndicator tone="warning" />
        </MeterTrack>
      </MeterRoot>
    </div>
  ),
}

export const Error: Story = {
  args: {
    'value': 100,
    'aria-label': 'Quota used',
  },
  render: args => (
    <div className="w-[320px]">
      <MeterRoot {...args}>
        <MeterTrack>
          <MeterIndicator tone="error" />
        </MeterTrack>
      </MeterRoot>
    </div>
  ),
}

export const ComposedWithLabelAndValue: Story = {
  args: {
    'value': 62,
    'aria-label': 'Storage used',
  },
  render: args => (
    <div className="w-[320px] space-y-2 rounded-xl bg-components-panel-bg p-4">
      <MeterRoot {...args}>
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
      <MeterRoot {...args}>
        <div className="flex items-center justify-between">
          <MeterLabel>Score</MeterLabel>
          <MeterValue />
        </div>
        <MeterTrack className="mt-2">
          <MeterIndicator />
        </MeterTrack>
      </MeterRoot>
    </div>
  ),
}
