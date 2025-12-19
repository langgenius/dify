import type { Meta, StoryObj } from '@storybook/nextjs'
import { useMemo, useState } from 'react'
import SimplePieChart from '.'

const PieChartPlayground = ({
  initialPercentage = 65,
  fill = '#fdb022',
  stroke = '#f79009',
}: {
  initialPercentage?: number
  fill?: string
  stroke?: string
}) => {
  const [percentage, setPercentage] = useState(initialPercentage)

  const label = useMemo(() => `${percentage}%`, [percentage])

  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
        <span>Conversion snapshot</span>
        <span className="rounded-md border border-divider-subtle bg-background-default px-2 py-1 text-[11px] text-text-secondary">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <SimplePieChart
          percentage={percentage}
          fill={fill}
          stroke={stroke}
          size={120}
        />
        <div className="flex flex-1 flex-col gap-2">
          <label className="flex items-center justify-between text-xs font-medium text-text-secondary">
            Target progress
            <span className="rounded bg-background-default px-2 py-1 text-[11px] text-text-tertiary">{label}</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={percentage}
            onChange={event => setPercentage(Number.parseInt(event.target.value, 10))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-divider-subtle accent-primary-600"
          />
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Data Display/SimplePieChart',
  component: PieChartPlayground,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Thin radial indicator built with ECharts. Use it for quick percentage snapshots inside cards.',
      },
    },
  },
  argTypes: {
    initialPercentage: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
    },
    fill: { control: 'color' },
    stroke: { control: 'color' },
  },
  args: {
    initialPercentage: 65,
    fill: '#fdb022',
    stroke: '#f79009',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PieChartPlayground>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const BrandAccent: Story = {
  args: {
    fill: '#155EEF',
    stroke: '#0040C1',
    initialPercentage: 82,
  },
}
