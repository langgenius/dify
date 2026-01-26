import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { InputNumber } from '.'

const meta = {
  title: 'Base/Data Entry/InputNumber',
  component: InputNumber,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Number input component with increment/decrement buttons. Supports min/max constraints, custom step amounts, and units display.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'number',
      description: 'Current value',
    },
    size: {
      control: 'select',
      options: ['regular', 'large'],
      description: 'Input size',
    },
    min: {
      control: 'number',
      description: 'Minimum value',
    },
    max: {
      control: 'number',
      description: 'Maximum value',
    },
    amount: {
      control: 'number',
      description: 'Step amount for increment/decrement',
    },
    unit: {
      control: 'text',
      description: 'Unit text displayed (e.g., "px", "ms")',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    defaultValue: {
      control: 'number',
      description: 'Default value when undefined',
    },
  },
  args: {
    onChange: (value) => {
      console.log('Value changed:', value)
    },
  },
} satisfies Meta<typeof InputNumber>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const InputNumberDemo = (args: any) => {
  const [value, setValue] = useState(args.value ?? 0)

  return (
    <div style={{ width: '300px' }}>
      <InputNumber
        {...args}
        value={value}
        onChange={(newValue) => {
          setValue(newValue)
          console.log('Value changed:', newValue)
        }}
      />
      <div className="mt-3 text-sm text-gray-600">
        Current value:
        {' '}
        <span className="font-semibold">{value}</span>
      </div>
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 0,
    size: 'regular',
  },
}

// Large size
export const LargeSize: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 10,
    size: 'large',
  },
}

// With min/max constraints
export const WithMinMax: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 5,
    min: 0,
    max: 10,
    size: 'regular',
  },
}

// With custom step amount
export const CustomStepAmount: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 50,
    amount: 5,
    min: 0,
    max: 100,
    size: 'regular',
  },
}

// With unit
export const WithUnit: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 100,
    unit: 'px',
    min: 0,
    max: 1000,
    amount: 10,
    size: 'regular',
  },
}

// Disabled state
export const Disabled: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 42,
    disabled: true,
    size: 'regular',
  },
}

// Decimal values
export const DecimalValues: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 2.5,
    amount: 0.5,
    min: 0,
    max: 10,
    size: 'regular',
  },
}

// Negative values allowed
export const NegativeValues: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 0,
    min: -100,
    max: 100,
    amount: 10,
    size: 'regular',
  },
}

// Size comparison
const SizeComparisonDemo = () => {
  const [regularValue, setRegularValue] = useState(10)
  const [largeValue, setLargeValue] = useState(20)

  return (
    <div className="flex flex-col gap-6" style={{ width: '300px' }}>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Regular Size</label>
        <InputNumber
          size="regular"
          value={regularValue}
          onChange={setRegularValue}
          min={0}
          max={100}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Large Size</label>
        <InputNumber
          size="large"
          value={largeValue}
          onChange={setLargeValue}
          min={0}
          max={100}
        />
      </div>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => <SizeComparisonDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Font size picker
const FontSizePickerDemo = () => {
  const [fontSize, setFontSize] = useState(16)

  return (
    <div style={{ width: '350px' }} className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Font Size</label>
          <InputNumber
            value={fontSize}
            onChange={setFontSize}
            min={8}
            max={72}
            amount={2}
            unit="px"
          />
        </div>
        <div className="rounded-lg bg-gray-50 p-4">
          <p style={{ fontSize: `${fontSize}px` }} className="text-gray-900">
            Preview Text
          </p>
        </div>
      </div>
    </div>
  )
}

export const FontSizePicker: Story = {
  render: () => <FontSizePickerDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Quantity selector
const QuantitySelectorDemo = () => {
  const [quantity, setQuantity] = useState(1)
  const pricePerItem = 29.99
  const total = (quantity * pricePerItem).toFixed(2)

  return (
    <div style={{ width: '350px' }} className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Product Name</h3>
            <p className="text-sm text-gray-500">
              $
              {pricePerItem}
              {' '}
              each
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Quantity</label>
          <InputNumber
            value={quantity}
            onChange={setQuantity}
            min={1}
            max={99}
            amount={1}
          />
        </div>
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Total</span>
            <span className="text-lg font-semibold text-gray-900">
              $
              {total}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export const QuantitySelector: Story = {
  render: () => <QuantitySelectorDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Timer settings
const TimerSettingsDemo = () => {
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(15)
  const [seconds, setSeconds] = useState(30)

  const totalSeconds = hours * 3600 + minutes * 60 + seconds

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Timer Configuration</h3>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Hours</label>
          <InputNumber
            value={hours}
            onChange={setHours}
            min={0}
            max={23}
            unit="h"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Minutes</label>
          <InputNumber
            value={minutes}
            onChange={setMinutes}
            min={0}
            max={59}
            unit="m"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Seconds</label>
          <InputNumber
            value={seconds}
            onChange={setSeconds}
            min={0}
            max={59}
            unit="s"
          />
        </div>
        <div className="mt-2 rounded-lg bg-blue-50 p-3">
          <div className="text-sm text-gray-600">
            Total duration:
            {' '}
            <span className="font-semibold">
              {totalSeconds}
              {' '}
              seconds
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export const TimerSettings: Story = {
  render: () => <TimerSettingsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Animation settings
const AnimationSettingsDemo = () => {
  const [duration, setDuration] = useState(300)
  const [delay, setDelay] = useState(0)
  const [iterations, setIterations] = useState(1)

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Animation Properties</h3>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Duration</label>
          <InputNumber
            value={duration}
            onChange={setDuration}
            min={0}
            max={5000}
            amount={50}
            unit="ms"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Delay</label>
          <InputNumber
            value={delay}
            onChange={setDelay}
            min={0}
            max={2000}
            amount={50}
            unit="ms"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Iterations</label>
          <InputNumber
            value={iterations}
            onChange={setIterations}
            min={1}
            max={10}
            amount={1}
          />
        </div>
        <div className="mt-2 rounded-lg bg-gray-50 p-4">
          <div className="font-mono text-xs text-gray-700">
            animation:
            {' '}
            {duration}
            ms
            {' '}
            {delay}
            ms
            {' '}
            {iterations}
          </div>
        </div>
      </div>
    </div>
  )
}

export const AnimationSettings: Story = {
  render: () => <AnimationSettingsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Temperature control
const TemperatureControlDemo = () => {
  const [temperature, setTemperature] = useState(20)
  const fahrenheit = ((temperature * 9) / 5 + 32).toFixed(1)

  return (
    <div style={{ width: '350px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Temperature Control</h3>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Set Temperature</label>
          <InputNumber
            size="large"
            value={temperature}
            onChange={setTemperature}
            min={16}
            max={30}
            amount={0.5}
            unit="°C"
          />
        </div>
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-gray-50 p-4">
          <div>
            <div className="text-xs text-gray-500">Celsius</div>
            <div className="text-2xl font-semibold text-gray-900">
              {temperature}
              °C
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Fahrenheit</div>
            <div className="text-2xl font-semibold text-gray-900">
              {fahrenheit}
              °F
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const TemperatureControl: Story = {
  render: () => <TemperatureControlDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Interactive playground
export const Playground: Story = {
  render: args => <InputNumberDemo {...args} />,
  args: {
    value: 10,
    size: 'regular',
    min: 0,
    max: 100,
    amount: 1,
    unit: '',
    disabled: false,
    defaultValue: 0,
  },
}
