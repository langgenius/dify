import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ProgressCircleColor, ProgressCircleSize } from '.'
import * as React from 'react'
import { ProgressCircle } from '.'

const colors: ProgressCircleColor[] = ['gray', 'white', 'blue', 'warning', 'error']
const sizes: ProgressCircleSize[] = ['small', 'medium', 'large']

const meta = {
  title: 'Base/UI/Progress',
  component: ProgressCircle,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Task progress primitives. ProgressCircle matches the Dify Design Kit circular Progress component and uses Base UI Progress semantics.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ProgressCircle>

export default meta

type Story = StoryObj<typeof meta>

export const Circle: Story = {
  args: {
    value: 42,
    color: 'blue',
    size: 'small',
    'aria-label': 'Uploading',
  },
}

export const CircleMatrix: Story = {
  args: {
    value: 62,
    'aria-label': 'Progress',
  },
  render: () => (
    <div className="grid grid-cols-[auto_auto_auto_auto] items-center gap-4 rounded-lg bg-components-panel-bg p-4">
      <div />
      {sizes.map((size) => (
        <div key={size} className="system-xs-medium text-text-tertiary">
          {size}
        </div>
      ))}
      {colors.map((color) => (
        <React.Fragment key={color}>
          <div className="system-xs-semibold-uppercase text-text-secondary">{color}</div>
          {sizes.map((size) => (
            <ProgressCircle
              key={`${color}-${size}`}
              value={62}
              color={color}
              size={size}
              aria-label={`${color} ${size} progress`}
            />
          ))}
        </React.Fragment>
      ))}
    </div>
  ),
}

export const Indeterminate: Story = {
  args: {
    value: null,
    color: 'gray',
    size: 'medium',
    'aria-label': 'Processing',
  },
}
