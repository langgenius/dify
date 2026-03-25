import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type * as React from 'react'
import { useState } from 'react'
import { Slider } from '.'

const meta = {
  title: 'Base UI/Data Entry/Slider',
  component: Slider,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Single-value horizontal slider built on Base UI.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'number',
    },
    min: {
      control: 'number',
    },
    max: {
      control: 'number',
    },
    step: {
      control: 'number',
    },
    disabled: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof Slider>

export default meta

type Story = StoryObj<typeof meta>

function SliderDemo({
  value: initialValue = 50,
  defaultValue: _defaultValue,
  ...args
}: React.ComponentProps<typeof Slider>) {
  const [value, setValue] = useState(initialValue)

  return (
    <div className="w-[320px] space-y-3">
      <Slider
        {...args}
        value={value}
        onValueChange={setValue}
        aria-label="Demo slider"
      />
      <div className="text-center text-text-secondary system-sm-medium">
        {value}
      </div>
    </div>
  )
}

export const Default: Story = {
  render: args => <SliderDemo {...args} />,
  args: {
    value: 50,
    min: 0,
    max: 100,
    step: 1,
  },
}

export const Decimal: Story = {
  render: args => <SliderDemo {...args} />,
  args: {
    value: 0.5,
    min: 0,
    max: 1,
    step: 0.1,
  },
}

export const Disabled: Story = {
  render: args => <SliderDemo {...args} />,
  args: {
    value: 75,
    min: 0,
    max: 100,
    step: 1,
    disabled: true,
  },
}
