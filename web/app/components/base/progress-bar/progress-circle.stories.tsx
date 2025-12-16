import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import ProgressCircle from './progress-circle'

const ProgressCircleDemo = ({
  initialPercentage = 42,
  size = 24,
}: {
  initialPercentage?: number
  size?: number
}) => {
  const [percentage, setPercentage] = useState(initialPercentage)

  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
        <span>Upload progress</span>
        <span className="rounded-md border border-divider-subtle bg-background-default px-2 py-1 text-[11px] text-text-secondary">
          {percentage}%
        </span>
      </div>
      <div className="flex items-center gap-4">
        <ProgressCircle percentage={percentage} size={size} className="shrink-0" />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percentage}
          onChange={event => setPercentage(Number.parseInt(event.target.value, 10))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-divider-subtle accent-primary-600"
        />
      </div>
      <div className="flex gap-3 text-xs text-text-tertiary">
        <label className="flex items-center gap-1">
          Size
          <input
            type="number"
            min={12}
            max={48}
            value={size}
            disabled
            className="h-7 w-16 rounded-md border border-divider-subtle bg-background-default px-2 text-xs"
          />
        </label>
      </div>
      <div className="rounded-lg border border-divider-subtle bg-background-default-subtle p-3 text-[11px] leading-relaxed text-text-tertiary">
        ProgressCircle renders a deterministic SVG slice. Advance the slider to preview how the arc grows for upload indicators.
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/ProgressCircle',
  component: ProgressCircleDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compact radial progress indicator wired to upload flows. The story provides a slider to scrub through percentages.',
      },
    },
  },
  argTypes: {
    initialPercentage: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
    },
    size: {
      control: { type: 'number', min: 12, max: 48, step: 2 },
    },
  },
  args: {
    initialPercentage: 42,
    size: 24,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ProgressCircleDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const NearComplete: Story = {
  args: {
    initialPercentage: 92,
  },
}
