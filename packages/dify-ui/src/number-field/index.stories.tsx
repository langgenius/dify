import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { Button } from '../button'
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from '../field'
import { Form } from '../form'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
} from './index'

const meta = {
  title: 'Base/Form/NumberField',
  component: NumberField,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound numeric input built on Base UI NumberField. Use it with FieldRoot for labelled, described, and validated form fields.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof NumberField>

export default meta

type Story = StoryObj<typeof meta>

type NumberFieldExampleProps = {
  id: string
  label: string
  name: string
  defaultValue?: number
  min?: number
  max?: number
  step?: number | 'any'
  placeholder?: string
  unit?: string
  size?: 'medium' | 'large'
  disabled?: boolean
  readOnly?: boolean
}

function NumberFieldExample({
  id,
  label,
  name,
  defaultValue,
  min,
  max,
  step,
  placeholder,
  unit,
  size = 'medium',
  disabled,
  readOnly,
}: NumberFieldExampleProps) {
  return (
    <div className="grid w-80 gap-1">
      <label htmlFor={id} className="text-text-secondary system-sm-medium">
        {label}
      </label>
      <NumberField
        id={id}
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        readOnly={readOnly}
      >
        <NumberFieldGroup size={size}>
          <NumberFieldInput placeholder={placeholder} size={size} />
          {unit && <NumberFieldUnit size={size}>{unit}</NumberFieldUnit>}
          <NumberFieldControls>
            <NumberFieldIncrement size={size} />
            <NumberFieldDecrement size={size} />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
    </div>
  )
}

export const Basic: Story = {
  render: () => (
    <NumberFieldExample
      id="top-k-basic"
      name="topK"
      label="Top K"
      defaultValue={3}
      min={1}
      max={10}
      step={1}
      placeholder="Set top K…"
    />
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <NumberFieldExample
        id="number-field-medium"
        name="mediumNumber"
        label="Medium"
        defaultValue={64}
        min={0}
        max={512}
        step={16}
        placeholder="Set value…"
      />
      <NumberFieldExample
        id="number-field-large"
        name="largeNumber"
        label="Large with unit"
        defaultValue={512}
        min={1}
        max={4000}
        step={32}
        placeholder="Set length…"
        unit="tokens"
        size="large"
      />
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <FieldRoot name="placeholderState">
        <FieldLabel>Placeholder</FieldLabel>
        <NumberField min={0} max={100}>
          <NumberFieldGroup>
            <NumberFieldInput placeholder="Set threshold…" />
            <NumberFieldUnit>%</NumberFieldUnit>
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </FieldRoot>
      <FieldRoot name="filledState">
        <FieldLabel>Filled</FieldLabel>
        <NumberField defaultValue={85} min={0} max={100}>
          <NumberFieldGroup>
            <NumberFieldInput />
            <NumberFieldUnit>%</NumberFieldUnit>
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </FieldRoot>
      <FieldRoot name="invalidState" invalid>
        <FieldLabel>Invalid</FieldLabel>
        <NumberField defaultValue={120} min={0} max={100}>
          <NumberFieldGroup>
            <NumberFieldInput />
            <NumberFieldUnit>%</NumberFieldUnit>
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
        <FieldError match>Use a value from 0 to 100.</FieldError>
      </FieldRoot>
      <FieldRoot name="disabledState">
        <FieldLabel>Disabled</FieldLabel>
        <NumberField defaultValue={5} min={0} max={10} disabled>
          <NumberFieldGroup>
            <NumberFieldInput />
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </FieldRoot>
      <FieldRoot name="readonlyState">
        <FieldLabel>Read-only</FieldLabel>
        <NumberField defaultValue={92} min={0} max={100} readOnly>
          <NumberFieldGroup>
            <NumberFieldInput />
            <NumberFieldUnit>%</NumberFieldUnit>
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </FieldRoot>
    </div>
  ),
}

function ControlledDemo() {
  const [value, setValue] = React.useState<number | null>(0.82)

  return (
    <FieldRoot name="controlledThreshold">
      <FieldLabel>Score threshold</FieldLabel>
      <NumberField
        value={value}
        min={0}
        max={1}
        step={0.01}
        format={{
          maximumFractionDigits: 2,
        }}
        onValueChange={setValue}
      >
        <NumberFieldGroup>
          <NumberFieldInput placeholder="0.00" />
          <NumberFieldControls>
            <NumberFieldIncrement />
            <NumberFieldDecrement />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
      <FieldDescription>
        Current value:
        {' '}
        {value === null ? 'Empty' : value.toFixed(2)}
      </FieldDescription>
    </FieldRoot>
  )
}

export const Controlled: Story = {
  render: () => (
    <div className="w-80">
      <ControlledDemo />
    </div>
  ),
}

function FormDemo() {
  const [savedValue, setSavedValue] = React.useState<string | null>(null)

  return (
    <Form
      aria-label="Retrieval settings"
      className="grid w-80 gap-4"
      onFormSubmit={(values) => {
        setSavedValue(String(values.topK ?? ''))
      }}
    >
      <FieldRoot name="topK">
        <FieldLabel>Top K</FieldLabel>
        <NumberField required defaultValue={3} min={1} max={10} step={1}>
          <NumberFieldGroup>
            <NumberFieldInput />
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
        <FieldDescription>Choose how many chunks are returned.</FieldDescription>
        <FieldError match="valueMissing">Top K is required.</FieldError>
        <FieldError match="rangeUnderflow">Use at least 1.</FieldError>
        <FieldError match="rangeOverflow">Use 10 or fewer.</FieldError>
      </FieldRoot>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">Save Settings</Button>
      </div>
      {savedValue && (
        <div className="rounded-lg bg-background-section px-3 py-2 text-text-secondary system-xs-regular">
          Saved:
          {' '}
          {savedValue}
        </div>
      )}
    </Form>
  )
}

export const WithField: Story = {
  render: () => <FormDemo />,
}

export const Formatting: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <FieldRoot name="currencyBudget">
        <FieldLabel>Budget</FieldLabel>
        <NumberField
          defaultValue={1200}
          min={0}
          step={100}
          format={{
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0,
          }}
        >
          <NumberFieldGroup>
            <NumberFieldInput />
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </FieldRoot>
      <FieldRoot name="temperature">
        <FieldLabel>Temperature</FieldLabel>
        <NumberField
          defaultValue={0.7}
          min={0}
          max={2}
          step={0.1}
          format={{
            maximumFractionDigits: 1,
          }}
        >
          <NumberFieldGroup>
            <NumberFieldInput />
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </FieldRoot>
    </div>
  ),
}
