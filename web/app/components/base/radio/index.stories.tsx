import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import Radio from '.'

const meta = {
  title: 'Base/Data Entry/Radio',
  component: Radio,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Radio component for single selection. Usually used with Radio.Group for multiple options.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    checked: {
      control: 'boolean',
      description: 'Checked state (for standalone radio)',
    },
    value: {
      control: 'text',
      description: 'Value of the radio option',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    children: {
      control: 'text',
      description: 'Label content',
    },
  },
} satisfies Meta<typeof Radio>

export default meta
type Story = StoryObj<typeof meta>

// Single radio demo
const SingleRadioDemo = (args: any) => {
  const [checked, setChecked] = useState(args.checked || false)

  return (
    <div style={{ width: '300px' }}>
      <Radio
        {...args}
        checked={checked}
        onChange={() => setChecked(!checked)}
      >
        {args.children || 'Radio option'}
      </Radio>
    </div>
  )
}

// Default single radio
export const Default: Story = {
  render: args => <SingleRadioDemo {...args} />,
  args: {
    checked: false,
    disabled: false,
    children: 'Single radio option',
  },
}

// Checked state
export const Checked: Story = {
  render: args => <SingleRadioDemo {...args} />,
  args: {
    checked: true,
    disabled: false,
    children: 'Selected option',
  },
}

// Disabled state
export const Disabled: Story = {
  render: args => <SingleRadioDemo {...args} />,
  args: {
    checked: false,
    disabled: true,
    children: 'Disabled option',
  },
}

// Disabled and checked
export const DisabledChecked: Story = {
  render: args => <SingleRadioDemo {...args} />,
  args: {
    checked: true,
    disabled: true,
    children: 'Disabled selected option',
  },
}

// Radio Group - Basic
const RadioGroupDemo = () => {
  const [value, setValue] = useState('option1')

  return (
    <div style={{ width: '400px' }}>
      <Radio.Group value={value} onChange={setValue}>
        <Radio value="option1">Option 1</Radio>
        <Radio value="option2">Option 2</Radio>
        <Radio value="option3">Option 3</Radio>
      </Radio.Group>
      <div className="mt-4 text-sm text-gray-600">
        Selected:
        {' '}
        <span className="font-semibold">{value}</span>
      </div>
    </div>
  )
}

export const RadioGroup: Story = {
  render: () => <RadioGroupDemo />,
}

// Radio Group - With descriptions
const RadioGroupWithDescriptionsDemo = () => {
  const [value, setValue] = useState('basic')

  return (
    <div style={{ width: '500px' }}>
      <h3 className="mb-3 text-sm font-medium text-gray-700">Select a plan</h3>
      <Radio.Group value={value} onChange={setValue}>
        <Radio value="basic">
          <div>
            <div className="font-medium">Basic Plan</div>
            <div className="text-xs text-gray-500">Free forever - Perfect for personal use</div>
          </div>
        </Radio>
        <Radio value="pro">
          <div>
            <div className="font-medium">Pro Plan</div>
            <div className="text-xs text-gray-500">$19/month - Advanced features for professionals</div>
          </div>
        </Radio>
        <Radio value="enterprise">
          <div>
            <div className="font-medium">Enterprise Plan</div>
            <div className="text-xs text-gray-500">Custom pricing - Full features and support</div>
          </div>
        </Radio>
      </Radio.Group>
    </div>
  )
}

export const RadioGroupWithDescriptions: Story = {
  render: () => <RadioGroupWithDescriptionsDemo />,
}

// Radio Group - With disabled option
const RadioGroupWithDisabledDemo = () => {
  const [value, setValue] = useState('available')

  return (
    <div style={{ width: '400px' }}>
      <Radio.Group value={value} onChange={setValue}>
        <Radio value="available">Available option</Radio>
        <Radio value="disabled" disabled>Disabled option</Radio>
        <Radio value="another">Another available option</Radio>
      </Radio.Group>
    </div>
  )
}

export const RadioGroupWithDisabled: Story = {
  render: () => <RadioGroupWithDisabledDemo />,
}

// Radio Group - Vertical layout
const VerticalLayoutDemo = () => {
  const [value, setValue] = useState('email')

  return (
    <div style={{ width: '400px' }}>
      <h3 className="mb-3 text-sm font-medium text-gray-700">Notification preferences</h3>
      <Radio.Group value={value} onChange={setValue} className="flex-col gap-2">
        <Radio value="email">Email notifications</Radio>
        <Radio value="sms">SMS notifications</Radio>
        <Radio value="push">Push notifications</Radio>
        <Radio value="none">No notifications</Radio>
      </Radio.Group>
    </div>
  )
}

export const VerticalLayout: Story = {
  render: () => <VerticalLayoutDemo />,
}

// Real-world example - Settings panel
const SettingsPanelDemo = () => {
  const [theme, setTheme] = useState('light')
  const [language, setLanguage] = useState('en')

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-6 text-lg font-semibold">Application Settings</h3>

      <div className="space-y-6">
        <div>
          <h4 className="mb-3 text-sm font-medium text-gray-700">Theme</h4>
          <Radio.Group value={theme} onChange={setTheme} className="flex-col gap-2">
            <Radio value="light">Light mode</Radio>
            <Radio value="dark">Dark mode</Radio>
            <Radio value="auto">Auto (system preference)</Radio>
          </Radio.Group>
        </div>

        <div className="border-t border-gray-200 pt-6">
          <h4 className="mb-3 text-sm font-medium text-gray-700">Language</h4>
          <Radio.Group value={language} onChange={setLanguage} className="flex-col gap-2">
            <Radio value="en">English</Radio>
            <Radio value="zh">中文 (Chinese)</Radio>
            <Radio value="es">Español (Spanish)</Radio>
            <Radio value="fr">Français (French)</Radio>
          </Radio.Group>
        </div>
      </div>

      <div className="mt-6 rounded-lg bg-blue-50 p-3">
        <div className="text-xs text-gray-600">
          <strong>Current settings:</strong>
          {' '}
          Theme:
          {theme}
          , Language:
          {language}
        </div>
      </div>
    </div>
  )
}

export const SettingsPanel: Story = {
  render: () => <SettingsPanelDemo />,
}

// Real-world example - Payment method selector
const PaymentMethodSelectorDemo = () => {
  const [paymentMethod, setPaymentMethod] = useState('credit_card')

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Payment Method</h3>
      <Radio.Group value={paymentMethod} onChange={setPaymentMethod} className="flex-col gap-3">
        <Radio value="credit_card">
          <div className="flex w-full items-center justify-between">
            <div>
              <div className="font-medium">Credit Card</div>
              <div className="text-xs text-gray-500">Visa, Mastercard, Amex</div>
            </div>
            <div className="text-xs text-gray-400">💳</div>
          </div>
        </Radio>
        <Radio value="paypal">
          <div className="flex w-full items-center justify-between">
            <div>
              <div className="font-medium">PayPal</div>
              <div className="text-xs text-gray-500">Fast and secure</div>
            </div>
            <div className="text-xs text-gray-400">🅿️</div>
          </div>
        </Radio>
        <Radio value="bank_transfer">
          <div className="flex w-full items-center justify-between">
            <div>
              <div className="font-medium">Bank Transfer</div>
              <div className="text-xs text-gray-500">1-3 business days</div>
            </div>
            <div className="text-xs text-gray-400">🏦</div>
          </div>
        </Radio>
      </Radio.Group>

      <button className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Continue with
        {' '}
        {paymentMethod.replace('_', ' ')}
      </button>
    </div>
  )
}

export const PaymentMethodSelector: Story = {
  render: () => <PaymentMethodSelectorDemo />,
}

// Real-world example - Shipping options
const ShippingOptionsDemo = () => {
  const [shipping, setShipping] = useState('standard')

  const shippingCosts = {
    standard: 5.99,
    express: 14.99,
    overnight: 29.99,
  }

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Shipping Method</h3>
      <Radio.Group value={shipping} onChange={setShipping} className="flex-col gap-3">
        <Radio value="standard">
          <div className="flex w-full items-center justify-between">
            <div>
              <div className="font-medium">Standard Shipping</div>
              <div className="text-xs text-gray-500">5-7 business days</div>
            </div>
            <div className="font-semibold text-gray-700">
              $
              {shippingCosts.standard}
            </div>
          </div>
        </Radio>
        <Radio value="express">
          <div className="flex w-full items-center justify-between">
            <div>
              <div className="font-medium">Express Shipping</div>
              <div className="text-xs text-gray-500">2-3 business days</div>
            </div>
            <div className="font-semibold text-gray-700">
              $
              {shippingCosts.express}
            </div>
          </div>
        </Radio>
        <Radio value="overnight">
          <div className="flex w-full items-center justify-between">
            <div>
              <div className="font-medium">Overnight Shipping</div>
              <div className="text-xs text-gray-500">Next business day</div>
            </div>
            <div className="font-semibold text-gray-700">
              $
              {shippingCosts.overnight}
            </div>
          </div>
        </Radio>
      </Radio.Group>

      <div className="mt-6 border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Shipping cost:</span>
          <span className="text-lg font-semibold text-gray-900">
            $
            {shippingCosts[shipping as keyof typeof shippingCosts]}
          </span>
        </div>
      </div>
    </div>
  )
}

export const ShippingOptions: Story = {
  render: () => <ShippingOptionsDemo />,
}

// Real-world example - Survey question
const SurveyQuestionDemo = () => {
  const [satisfaction, setSatisfaction] = useState('')

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-2 text-base font-semibold">Customer Satisfaction Survey</h3>
      <p className="mb-4 text-sm text-gray-600">How satisfied are you with our service?</p>

      <Radio.Group value={satisfaction} onChange={setSatisfaction} className="flex-col gap-2">
        <Radio value="very_satisfied">
          <div className="flex items-center gap-2">
            <span>😄</span>
            <span>Very satisfied</span>
          </div>
        </Radio>
        <Radio value="satisfied">
          <div className="flex items-center gap-2">
            <span>🙂</span>
            <span>Satisfied</span>
          </div>
        </Radio>
        <Radio value="neutral">
          <div className="flex items-center gap-2">
            <span>😐</span>
            <span>Neutral</span>
          </div>
        </Radio>
        <Radio value="dissatisfied">
          <div className="flex items-center gap-2">
            <span>😟</span>
            <span>Dissatisfied</span>
          </div>
        </Radio>
        <Radio value="very_dissatisfied">
          <div className="flex items-center gap-2">
            <span>😢</span>
            <span>Very dissatisfied</span>
          </div>
        </Radio>
      </Radio.Group>

      <button
        className="mt-6 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!satisfaction}
      >
        Submit Feedback
      </button>
    </div>
  )
}

export const SurveyQuestion: Story = {
  render: () => <SurveyQuestionDemo />,
}

// Interactive playground
const PlaygroundDemo = () => {
  const [value, setValue] = useState('option1')

  return (
    <div style={{ width: '400px' }}>
      <Radio.Group value={value} onChange={setValue}>
        <Radio value="option1">Option 1</Radio>
        <Radio value="option2">Option 2</Radio>
        <Radio value="option3">Option 3</Radio>
        <Radio value="option4" disabled>Disabled option</Radio>
      </Radio.Group>
      <div className="mt-4 text-sm text-gray-600">
        Selected:
        {' '}
        <span className="font-semibold">{value}</span>
      </div>
    </div>
  )
}

export const Playground: Story = {
  render: () => <PlaygroundDemo />,
}
