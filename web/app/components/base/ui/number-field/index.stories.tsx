import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useId, useState } from 'react'
import { cn } from '@/utils/classnames'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
} from '.'

type DemoFieldProps = {
  label: string
  helperText: string
  placeholder: string
  size: 'regular' | 'large'
  unit?: string
  defaultValue?: number | null
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  readOnly?: boolean
  showCurrentValue?: boolean
  widthClassName?: string
  formatValue?: (value: number | null) => string
}

const formatNumericValue = (value: number | null, unit?: string) => {
  if (value === null)
    return 'Empty'

  if (!unit)
    return String(value)

  return `${value} ${unit}`
}

const FieldLabel = ({
  inputId,
  label,
  helperText,
}: Pick<DemoFieldProps, 'label' | 'helperText'> & { inputId: string }) => (
  <div className="space-y-1">
    <label htmlFor={inputId} className="text-text-secondary system-sm-medium">
      {label}
    </label>
    <p className="text-text-tertiary system-xs-regular">{helperText}</p>
  </div>
)

const DemoField = ({
  label,
  helperText,
  placeholder,
  size,
  unit,
  defaultValue,
  min,
  max,
  step,
  disabled,
  readOnly,
  showCurrentValue,
  widthClassName,
  formatValue,
}: DemoFieldProps) => {
  const inputId = useId()
  const [value, setValue] = useState<number | null>(defaultValue ?? null)

  return (
    <div className={cn('flex w-full max-w-80 flex-col gap-2', widthClassName)}>
      <FieldLabel inputId={inputId} label={label} helperText={helperText} />
      <NumberField
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        readOnly={readOnly}
        onValueChange={setValue}
      >
        <NumberFieldGroup size={size}>
          <NumberFieldInput
            id={inputId}
            aria-label={label}
            placeholder={placeholder}
            size={size}
          />
          {unit && <NumberFieldUnit size={size}>{unit}</NumberFieldUnit>}
          <NumberFieldControls>
            <NumberFieldIncrement size={size} />
            <NumberFieldDecrement size={size} />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
      {showCurrentValue && (
        <p className="text-text-quaternary system-xs-regular">
          Current value:
          {' '}
          {formatValue ? formatValue(value) : formatNumericValue(value, unit)}
        </p>
      )}
    </div>
  )
}

const meta = {
  title: 'Base/Form/NumberField',
  component: NumberField,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound numeric input built on Base UI NumberField. Stories explicitly enumerate the shipped CVA variants, then cover realistic numeric-entry cases such as decimals, empty values, range limits, read-only, and disabled states.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof NumberField>

export default meta
type Story = StoryObj<typeof meta>

export const VariantMatrix: Story = {
  render: () => (
    <div className="grid w-[720px] gap-6 md:grid-cols-2">
      <DemoField
        label="Top K"
        helperText="Regular size without suffix. Covers the regular group, input, and control button spacing."
        placeholder="Set top K"
        size="regular"
        defaultValue={3}
        min={1}
        max={10}
        step={1}
      />
      <DemoField
        label="Score threshold"
        helperText="Regular size with a suffix so the regular unit variant is visible."
        placeholder="Set threshold"
        size="regular"
        unit="%"
        defaultValue={85}
        min={0}
        max={100}
        step={1}
      />
      <DemoField
        label="Chunk overlap"
        helperText="Large size without suffix. Matches the larger dataset form treatment."
        placeholder="Set overlap"
        size="large"
        defaultValue={64}
        min={0}
        max={512}
        step={16}
      />
      <DemoField
        label="Max segment length"
        helperText="Large size with suffix so the large unit variant is also enumerated."
        placeholder="Set length"
        size="large"
        unit="tokens"
        defaultValue={512}
        min={1}
        max={4000}
        step={32}
      />
    </div>
  ),
}

export const DecimalInputs: Story = {
  render: () => (
    <div className="grid w-[720px] gap-6 md:grid-cols-2">
      <DemoField
        label="Score threshold"
        helperText="Two-decimal precision with a 0.01 step, like retrieval tuning fields."
        placeholder="0.00"
        size="regular"
        defaultValue={0.82}
        min={0}
        max={1}
        step={0.01}
        showCurrentValue
        formatValue={value => value === null ? 'Empty' : value.toFixed(2)}
      />
      <DemoField
        label="Temperature"
        helperText="One-decimal stepping for generation parameters."
        placeholder="0.0"
        size="large"
        defaultValue={0.7}
        min={0}
        max={2}
        step={0.1}
        showCurrentValue
        formatValue={value => value === null ? 'Empty' : value.toFixed(1)}
      />
      <DemoField
        label="Penalty"
        helperText="Starts empty so the placeholder and empty numeric state are both visible."
        placeholder="Optional"
        size="regular"
        defaultValue={null}
        min={0}
        max={2}
        step={0.05}
        showCurrentValue
        formatValue={value => value === null ? 'Empty' : value.toFixed(2)}
      />
      <DemoField
        label="Latency budget"
        helperText="Decimal input with a unit suffix and larger spacing."
        placeholder="0.0"
        size="large"
        unit="s"
        defaultValue={1.5}
        min={0.5}
        max={10}
        step={0.5}
        showCurrentValue
        formatValue={value => value === null ? 'Empty' : `${value.toFixed(1)} s`}
      />
    </div>
  ),
}

export const BoundariesAndStates: Story = {
  render: () => (
    <div className="grid w-[720px] gap-6 md:grid-cols-2">
      <DemoField
        label="HTTP status code"
        helperText="Integer-only style usage with tighter bounds from 100 to 599."
        placeholder="200"
        size="regular"
        defaultValue={200}
        min={100}
        max={599}
        step={1}
        showCurrentValue
      />
      <DemoField
        label="Request timeout"
        helperText="Bounded regular input with suffix, common in system settings."
        placeholder="Set timeout"
        size="regular"
        unit="ms"
        defaultValue={1200}
        min={100}
        max={10000}
        step={100}
        showCurrentValue
      />
      <DemoField
        label="Retry count"
        helperText="Disabled state preserves the layout while switching to disabled tokens."
        placeholder="Retry count"
        size="large"
        defaultValue={5}
        min={0}
        max={10}
        step={1}
        disabled
        showCurrentValue
      />
      <DemoField
        label="Archived score threshold"
        helperText="Read-only state keeps the same structure but removes interactive affordances."
        placeholder="0.00"
        size="large"
        unit="%"
        defaultValue={92}
        min={0}
        max={100}
        step={1}
        readOnly
        showCurrentValue
      />
    </div>
  ),
}
