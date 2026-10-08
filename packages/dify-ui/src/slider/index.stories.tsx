import type { Meta, StoryObj } from '@storybook/react-vite'
import type { SliderProps } from '.'
import { expect } from 'storybook/test'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
  SliderValue,
} from '.'

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
  return (
    <Slider {...args} defaultValue={initialValue} className="w-80 flex-col gap-3">
      <SliderLabel className="sr-only">Demo slider</SliderLabel>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb />
        </SliderTrack>
      </SliderControl>
      <SliderValue className="text-center system-sm-medium text-text-secondary" />
    </Slider>
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
  play: async ({ canvas, userEvent }) => {
    const slider = canvas.getByRole('slider', { name: 'Demo slider' })
    const output = canvas.getByRole('status')
    await expect(output).toHaveTextContent('50')
    await expect(output).toHaveAttribute('for', slider.id)
    await userEvent.tab()
    await expect(slider).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(output).toHaveTextContent('51')
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
  return (
    <Slider<PriceRange> defaultValue={[25, 75]} min={0} max={100} className="w-80 flex-col gap-1">
      <SliderLabel>Price range</SliderLabel>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb index={0} aria-label="Minimum price" />
          <SliderThumb index={1} aria-label="Maximum price" />
        </SliderTrack>
      </SliderControl>
      <SliderValue className="mt-2 text-center system-sm-medium text-text-secondary" />
    </Slider>
  )
}

export const Range: Story = {
  render: () => <RangeSliderDemo />,
  play: async ({ canvas, userEvent }) => {
    const slider = canvas.getByRole('slider', { name: 'Minimum price' })
    const output = canvas.getByRole('status')
    await expect(output).toHaveTextContent('25 – 75')
    await userEvent.tab()
    await expect(slider).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(output).toHaveTextContent('26 – 75')
  },
}
