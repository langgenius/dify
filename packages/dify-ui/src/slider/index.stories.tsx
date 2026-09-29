import type { Meta, StoryObj } from '@storybook/react-vite'
import type { SliderProps } from '.'
import * as React from 'react'
import { Slider, SliderControl, SliderIndicator, SliderLabel, SliderThumb, SliderTrack } from '.'

const meta = {
  title: 'Base/Form/Slider',
  component: Slider,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Styled Base UI slider anatomy for single-value and range controls.',
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
} satisfies Meta<SliderProps<number>>

export default meta

type Story = StoryObj<SliderProps<number>>

function SliderDemo({
  value: initialValue = 50,
  defaultValue: _defaultValue,
  ...args
}: SliderProps<number>) {
  const [value, setValue] = React.useState(initialValue)

  return (
    <div className="w-[320px] space-y-3">
      <Slider {...args} value={value} onValueChange={setValue}>
        <SliderLabel className="sr-only">Demo slider</SliderLabel>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <div className="text-center system-sm-medium text-text-secondary">{value}</div>
    </div>
  )
}

export const Default: Story = {
  render: (args) => <SliderDemo {...args} />,
  args: {
    value: 50,
    min: 0,
    max: 100,
    step: 1,
  },
}

export const Decimal: Story = {
  render: (args) => <SliderDemo {...args} />,
  args: {
    value: 0.5,
    min: 0,
    max: 1,
    step: 0.1,
  },
}

export const Disabled: Story = {
  render: (args) => <SliderDemo {...args} />,
  args: {
    value: 75,
    min: 0,
    max: 100,
    step: 1,
    disabled: true,
  },
}

export const Vertical: Story = {
  render: () => (
    <Slider defaultValue={40} orientation="vertical">
      <SliderLabel className="sr-only">Volume</SliderLabel>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb />
        </SliderTrack>
      </SliderControl>
    </Slider>
  ),
}

export const ComposedWithLabel: Story = {
  render: () => (
    <Slider defaultValue={50} className="w-[320px] flex-col gap-1">
      <SliderLabel>Temperature</SliderLabel>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb />
        </SliderTrack>
      </SliderControl>
    </Slider>
  ),
}

type PriceRange = readonly [number, number]

function RangeSliderDemo() {
  const [range, setRange] = React.useState<PriceRange>([25, 75])

  return (
    <div className="w-[320px] space-y-3">
      <Slider<PriceRange>
        value={range}
        onValueChange={setRange}
        min={0}
        max={100}
        className="flex-col gap-1"
      >
        <SliderLabel>Price range</SliderLabel>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb index={0} aria-label="Minimum price" />
            <SliderThumb index={1} aria-label="Maximum price" />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <div className="text-center system-sm-medium text-text-secondary">
        {range[0]} – {range[1]}
      </div>
    </div>
  )
}

export const Range: Story = {
  render: () => <RangeSliderDemo />,
}
