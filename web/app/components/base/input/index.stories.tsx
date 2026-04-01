import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import Input from '.'

const meta = {
  title: 'Base/Data Entry/Input',
  component: Input,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Input component with support for icons, clear button, validation states, and units. Includes automatic leading zero removal for number inputs.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['regular', 'large'],
      description: 'Input size',
    },
    type: {
      control: 'select',
      options: ['text', 'number', 'email', 'password', 'url', 'tel'],
      description: 'Input type',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    destructive: {
      control: 'boolean',
      description: 'Error/destructive state',
    },
    showLeftIcon: {
      control: 'boolean',
      description: 'Show search icon on left',
    },
    showClearIcon: {
      control: 'boolean',
      description: 'Show clear button when input has value',
    },
    unit: {
      control: 'text',
      description: 'Unit text displayed on right (e.g., "px", "ms")',
    },
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const InputDemo = (args: any) => {
  const [value, setValue] = useState(args.value || '')

  return (
    <div style={{ width: '400px' }}>
      <Input
        {...args}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          console.log('Input changed:', e.target.value)
        }}
        onClear={() => {
          setValue('')
          console.log('Input cleared')
        }}
      />
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    placeholder: 'Enter text...',
    type: 'text',
  },
}

// Large size
export const LargeSize: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'large',
    placeholder: 'Enter text...',
    type: 'text',
  },
}

// With search icon
export const WithSearchIcon: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    showLeftIcon: true,
    placeholder: 'Search...',
    type: 'text',
  },
}

// With clear button
export const WithClearButton: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    showClearIcon: true,
    value: 'Some text to clear',
    placeholder: 'Type something...',
    type: 'text',
  },
}

// Search input (icon + clear)
export const SearchInput: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    showLeftIcon: true,
    showClearIcon: true,
    value: '',
    placeholder: 'Search...',
    type: 'text',
  },
}

// Disabled state
export const Disabled: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    value: 'Disabled input',
    disabled: true,
    type: 'text',
  },
}

// Destructive/error state
export const DestructiveState: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    value: 'invalid@email',
    destructive: true,
    placeholder: 'Enter email...',
    type: 'email',
  },
}

// Number input
export const NumberInput: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    type: 'number',
    placeholder: 'Enter a number...',
    value: '0',
  },
}

// With unit
export const WithUnit: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    type: 'number',
    value: '100',
    unit: 'px',
    placeholder: 'Enter value...',
  },
}

// Email input
export const EmailInput: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    type: 'email',
    placeholder: 'Enter your email...',
    showClearIcon: true,
  },
}

// Password input
export const PasswordInput: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    type: 'password',
    placeholder: 'Enter password...',
    value: 'secret123',
  },
}

// Size comparison
const SizeComparisonDemo = () => {
  const [regularValue, setRegularValue] = useState('')
  const [largeValue, setLargeValue] = useState('')

  return (
    <div className="flex flex-col gap-6" style={{ width: '400px' }}>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Regular Size</label>
        <Input
          size="regular"
          value={regularValue}
          onChange={e => setRegularValue(e.target.value)}
          placeholder="Regular input..."
          showClearIcon
          onClear={() => setRegularValue('')}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Large Size</label>
        <Input
          size="large"
          value={largeValue}
          onChange={e => setLargeValue(e.target.value)}
          placeholder="Large input..."
          showClearIcon
          onClear={() => setLargeValue('')}
        />
      </div>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => <SizeComparisonDemo />,
}

// State comparison
const StateComparisonDemo = () => {
  const [normalValue, setNormalValue] = useState('Normal state')
  const [errorValue, setErrorValue] = useState('Error state')

  return (
    <div className="flex flex-col gap-6" style={{ width: '400px' }}>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Normal</label>
        <Input
          value={normalValue}
          onChange={e => setNormalValue(e.target.value)}
          showClearIcon
          onClear={() => setNormalValue('')}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Destructive</label>
        <Input
          value={errorValue}
          onChange={e => setErrorValue(e.target.value)}
          destructive
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Disabled</label>
        <Input
          value="Disabled input"
          onChange={() => undefined}
          disabled
        />
      </div>
    </div>
  )
}

export const StateComparison: Story = {
  render: () => <StateComparisonDemo />,
}

// Form example
const FormExampleDemo = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    age: '',
    website: '',
  })
  const [errors, setErrors] = useState({
    email: false,
    age: false,
  })

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email)
  }

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">User Profile</h3>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Name</label>
          <Input
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            placeholder="Enter your name..."
            showClearIcon
            onClear={() => setFormData({ ...formData, name: '' })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Email</label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => {
              setFormData({ ...formData, email: e.target.value })
              setErrors({ ...errors, email: e.target.value ? !validateEmail(e.target.value) : false })
            }}
            placeholder="Enter your email..."
            destructive={errors.email}
            showClearIcon
            onClear={() => {
              setFormData({ ...formData, email: '' })
              setErrors({ ...errors, email: false })
            }}
          />
          {errors.email && (
            <span className="text-xs text-red-600">Please enter a valid email address</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Age</label>
          <Input
            type="number"
            value={formData.age}
            onChange={(e) => {
              setFormData({ ...formData, age: e.target.value })
              setErrors({ ...errors, age: e.target.value ? Number(e.target.value) < 18 : false })
            }}
            placeholder="Enter your age..."
            destructive={errors.age}
            unit="years"
          />
          {errors.age && (
            <span className="text-xs text-red-600">Must be 18 or older</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Website</label>
          <Input
            type="url"
            value={formData.website}
            onChange={e => setFormData({ ...formData, website: e.target.value })}
            placeholder="https://example.com"
            showClearIcon
            onClear={() => setFormData({ ...formData, website: '' })}
          />
        </div>
      </div>
    </div>
  )
}

export const FormExample: Story = {
  render: () => <FormExampleDemo />,
}

// Search example
const SearchExampleDemo = () => {
  const [searchQuery, setSearchQuery] = useState('')
  const items = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape']
  const filteredItems = items.filter(item =>
    item.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div style={{ width: '400px' }} className="flex flex-col gap-4">
      <Input
        size="large"
        showLeftIcon
        showClearIcon
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        onClear={() => setSearchQuery('')}
        placeholder="Search fruits..."
      />
      {searchQuery && (
        <div className="rounded-lg bg-gray-50 p-4">
          <div className="mb-2 text-xs text-gray-500">
            {filteredItems.length}
            {' '}
            result
            {filteredItems.length !== 1 ? 's' : ''}
          </div>
          <div className="flex flex-col gap-1">
            {filteredItems.map(item => (
              <div key={item} className="text-sm text-gray-700">
                {item}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const SearchExample: Story = {
  render: () => <SearchExampleDemo />,
}

// Interactive playground
export const Playground: Story = {
  render: args => <InputDemo {...args} />,
  args: {
    size: 'regular',
    type: 'text',
    placeholder: 'Type something...',
    disabled: false,
    destructive: false,
    showLeftIcon: false,
    showClearIcon: true,
    unit: '',
  },
}
