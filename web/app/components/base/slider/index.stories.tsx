import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import Slider from '.'

const meta = {
  title: 'Base/Data Entry/Slider',
  component: Slider,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Slider component for selecting a numeric value within a range. Built on react-slider with customizable min/max/step values.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'number',
      description: 'Current slider value',
    },
    min: {
      control: 'number',
      description: 'Minimum value (default: 0)',
    },
    max: {
      control: 'number',
      description: 'Maximum value (default: 100)',
    },
    step: {
      control: 'number',
      description: 'Step increment (default: 1)',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
  },
  args: {
    onChange: (value) => {
      console.log('Slider value:', value)
    },
  },
} satisfies Meta<typeof Slider>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const SliderDemo = (args: any) => {
  const [value, setValue] = useState(args.value || 50)

  return (
    <div style={{ width: '400px' }}>
      <Slider
        {...args}
        value={value}
        onChange={(v) => {
          setValue(v)
          console.log('Slider value:', v)
        }}
      />
      <div className="mt-4 text-center text-sm text-gray-600">
        Value:
        {' '}
        <span className="text-lg font-semibold">{value}</span>
      </div>
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <SliderDemo {...args} />,
  args: {
    value: 50,
    min: 0,
    max: 100,
    step: 1,
    disabled: false,
  },
}

// With custom range
export const CustomRange: Story = {
  render: args => <SliderDemo {...args} />,
  args: {
    value: 25,
    min: 0,
    max: 50,
    step: 1,
    disabled: false,
  },
}

// With step increment
export const WithStepIncrement: Story = {
  render: args => <SliderDemo {...args} />,
  args: {
    value: 50,
    min: 0,
    max: 100,
    step: 10,
    disabled: false,
  },
}

// Decimal values
export const DecimalValues: Story = {
  render: args => <SliderDemo {...args} />,
  args: {
    value: 2.5,
    min: 0,
    max: 5,
    step: 0.5,
    disabled: false,
  },
}

// Disabled state
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

// Real-world example - Volume control
const VolumeControlDemo = () => {
  const [volume, setVolume] = useState(70)

  const getVolumeIcon = (vol: number) => {
    if (vol === 0)
      return '🔇'
    if (vol < 33)
      return '🔈'
    if (vol < 66)
      return '🔉'
    return '🔊'
  }

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Volume Control</h3>
        <span className="text-2xl">{getVolumeIcon(volume)}</span>
      </div>
      <Slider
        value={volume}
        min={0}
        max={100}
        step={1}
        onChange={setVolume}
      />
      <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
        <span>Mute</span>
        <span className="text-lg font-semibold">
          {volume}
          %
        </span>
        <span>Max</span>
      </div>
    </div>
  )
}

export const VolumeControl: Story = {
  render: () => <VolumeControlDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Brightness control
const BrightnessControlDemo = () => {
  const [brightness, setBrightness] = useState(80)

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Screen Brightness</h3>
        <span className="text-2xl">☀️</span>
      </div>
      <Slider
        value={brightness}
        min={0}
        max={100}
        step={5}
        onChange={setBrightness}
      />
      <div className="mt-4 rounded-lg bg-gray-50 p-4" style={{ opacity: brightness / 100 }}>
        <div className="text-sm text-gray-700">
          Preview at
          {' '}
          {brightness}
          % brightness
        </div>
      </div>
    </div>
  )
}

export const BrightnessControl: Story = {
  render: () => <BrightnessControlDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Price range filter
const PriceRangeFilterDemo = () => {
  const [maxPrice, setMaxPrice] = useState(500)
  const minPrice = 0

  const products = [
    { name: 'Product A', price: 150 },
    { name: 'Product B', price: 350 },
    { name: 'Product C', price: 600 },
    { name: 'Product D', price: 250 },
    { name: 'Product E', price: 450 },
  ]

  const filteredProducts = products.filter(p => p.price >= minPrice && p.price <= maxPrice)

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Filter by Price</h3>
      <div className="mb-2">
        <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
          <span>Maximum Price</span>
          <span className="font-semibold text-gray-900">
            $
            {maxPrice}
          </span>
        </div>
        <Slider
          value={maxPrice}
          min={0}
          max={1000}
          step={50}
          onChange={setMaxPrice}
        />
      </div>
      <div className="mt-6">
        <div className="mb-3 text-sm font-medium text-gray-700">
          Showing
          {' '}
          {filteredProducts.length}
          {' '}
          of
          {' '}
          {products.length}
          {' '}
          products
        </div>
        <div className="space-y-2">
          {filteredProducts.map(product => (
            <div key={product.name} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
              <span className="text-sm">{product.name}</span>
              <span className="font-semibold text-gray-900">
                $
                {product.price}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const PriceRangeFilter: Story = {
  render: () => <PriceRangeFilterDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Temperature selector
const TemperatureSelectorDemo = () => {
  const [temperature, setTemperature] = useState(22)
  const fahrenheit = ((temperature * 9) / 5 + 32).toFixed(1)

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Thermostat Control</h3>
      <div className="mb-6">
        <Slider
          value={temperature}
          min={16}
          max={30}
          step={0.5}
          onChange={setTemperature}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-blue-50 p-4 text-center">
          <div className="mb-1 text-xs text-gray-600">Celsius</div>
          <div className="text-3xl font-bold text-blue-600">
            {temperature}
            °C
          </div>
        </div>
        <div className="rounded-lg bg-orange-50 p-4 text-center">
          <div className="mb-1 text-xs text-gray-600">Fahrenheit</div>
          <div className="text-3xl font-bold text-orange-600">
            {fahrenheit}
            °F
          </div>
        </div>
      </div>
      <div className="mt-4 text-center text-xs text-gray-500">
        {temperature < 18 && '🥶 Too cold'}
        {temperature >= 18 && temperature <= 24 && '😊 Comfortable'}
        {temperature > 24 && '🥵 Too warm'}
      </div>
    </div>
  )
}

export const TemperatureSelector: Story = {
  render: () => <TemperatureSelectorDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Progress/completion slider
const ProgressSliderDemo = () => {
  const [progress, setProgress] = useState(65)

  return (
    <div style={{ width: '450px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Project Completion</h3>
      <Slider
        value={progress}
        min={0}
        max={100}
        step={5}
        onChange={setProgress}
      />
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-gray-600">Progress</span>
          <span className="text-lg font-bold text-blue-600">
            {progress}
            %
          </span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={progress >= 25 ? '✅' : '⏳'}>Planning</span>
            <span className="text-xs text-gray-500">25%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={progress >= 50 ? '✅' : '⏳'}>Development</span>
            <span className="text-xs text-gray-500">50%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={progress >= 75 ? '✅' : '⏳'}>Testing</span>
            <span className="text-xs text-gray-500">75%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={progress >= 100 ? '✅' : '⏳'}>Deployment</span>
            <span className="text-xs text-gray-500">100%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export const ProgressSlider: Story = {
  render: () => <ProgressSliderDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Zoom control
const ZoomControlDemo = () => {
  const [zoom, setZoom] = useState(100)

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Zoom Level</h3>
      <div className="flex items-center gap-4">
        <button
          className="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300"
          onClick={() => setZoom(Math.max(50, zoom - 10))}
        >
          -
        </button>
        <div className="flex-1">
          <Slider
            value={zoom}
            min={50}
            max={200}
            step={10}
            onChange={setZoom}
          />
        </div>
        <button
          className="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300"
          onClick={() => setZoom(Math.min(200, zoom + 10))}
        >
          +
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
        <span>50%</span>
        <span className="text-lg font-semibold">
          {zoom}
          %
        </span>
        <span>200%</span>
      </div>
      <div className="mt-4 rounded-lg bg-gray-50 p-4 text-center" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center' }}>
        <div className="text-sm">Preview content</div>
      </div>
    </div>
  )
}

export const ZoomControl: Story = {
  render: () => <ZoomControlDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - AI model parameters
const AIModelParametersDemo = () => {
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2000)
  const [topP, setTopP] = useState(0.9)

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Model Configuration</h3>
      <div className="space-y-6">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Temperature</label>
            <span className="text-sm font-semibold">{temperature}</span>
          </div>
          <Slider
            value={temperature}
            min={0}
            max={2}
            step={0.1}
            onChange={setTemperature}
          />
          <p className="mt-1 text-xs text-gray-500">
            Controls randomness. Lower is more focused, higher is more creative.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Max Tokens</label>
            <span className="text-sm font-semibold">{maxTokens}</span>
          </div>
          <Slider
            value={maxTokens}
            min={100}
            max={4000}
            step={100}
            onChange={setMaxTokens}
          />
          <p className="mt-1 text-xs text-gray-500">
            Maximum length of generated response.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Top P</label>
            <span className="text-sm font-semibold">{topP}</span>
          </div>
          <Slider
            value={topP}
            min={0}
            max={1}
            step={0.05}
            onChange={setTopP}
          />
          <p className="mt-1 text-xs text-gray-500">
            Nucleus sampling threshold.
          </p>
        </div>
      </div>
      <div className="mt-6 rounded-lg bg-blue-50 p-4 text-xs text-gray-700">
        <div>
          <strong>Temperature:</strong>
          {' '}
          {temperature}
        </div>
        <div>
          <strong>Max Tokens:</strong>
          {' '}
          {maxTokens}
        </div>
        <div>
          <strong>Top P:</strong>
          {' '}
          {topP}
        </div>
      </div>
    </div>
  )
}

export const AIModelParameters: Story = {
  render: () => <AIModelParametersDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Image quality selector
const ImageQualitySelectorDemo = () => {
  const [quality, setQuality] = useState(80)

  const getQualityLabel = (q: number) => {
    if (q < 50)
      return 'Low'
    if (q < 70)
      return 'Medium'
    if (q < 90)
      return 'High'
    return 'Maximum'
  }

  const estimatedSize = Math.round((quality / 100) * 5)

  return (
    <div style={{ width: '450px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Image Export Quality</h3>
      <Slider
        value={quality}
        min={10}
        max={100}
        step={10}
        onChange={setQuality}
      />
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-xs text-gray-600">Quality</div>
          <div className="text-lg font-semibold">{getQualityLabel(quality)}</div>
          <div className="text-xs text-gray-500">
            {quality}
            %
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-xs text-gray-600">File Size</div>
          <div className="text-lg font-semibold">
            ~
            {estimatedSize}
            {' '}
            MB
          </div>
          <div className="text-xs text-gray-500">Estimated</div>
        </div>
      </div>
    </div>
  )
}

export const ImageQualitySelector: Story = {
  render: () => <ImageQualitySelectorDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Multiple sliders
const MultipleSlidersDemo = () => {
  const [red, setRed] = useState(128)
  const [green, setGreen] = useState(128)
  const [blue, setBlue] = useState(128)

  const rgbColor = `rgb(${red}, ${green}, ${blue})`

  return (
    <div style={{ width: '450px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">RGB Color Picker</h3>
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-red-600">Red</label>
            <span className="text-sm font-semibold">{red}</span>
          </div>
          <Slider value={red} min={0} max={255} step={1} onChange={setRed} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-green-600">Green</label>
            <span className="text-sm font-semibold">{green}</span>
          </div>
          <Slider value={green} min={0} max={255} step={1} onChange={setGreen} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-blue-600">Blue</label>
            <span className="text-sm font-semibold">{blue}</span>
          </div>
          <Slider value={blue} min={0} max={255} step={1} onChange={setBlue} />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between">
        <div
          className="h-24 w-24 rounded-lg border-2 border-gray-300"
          style={{ backgroundColor: rgbColor }}
        />
        <div className="text-right">
          <div className="mb-1 text-xs text-gray-600">Color Value</div>
          <div className="font-mono text-sm font-semibold">{rgbColor}</div>
          <div className="mt-1 font-mono text-xs text-gray-500">
            #
            {red.toString(16).padStart(2, '0')}
            {green.toString(16).padStart(2, '0')}
            {blue.toString(16).padStart(2, '0')}
          </div>
        </div>
      </div>
    </div>
  )
}

export const MultipleSliders: Story = {
  render: () => <MultipleSlidersDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Interactive playground
export const Playground: Story = {
  render: args => <SliderDemo {...args} />,
  args: {
    value: 50,
    min: 0,
    max: 100,
    step: 1,
    disabled: false,
  },
}
