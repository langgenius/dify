import type { InputProps } from '@langgenius/dify-ui/input'
import type {
  NumberFieldInputProps,
  NumberFieldProps,
  NumberFieldSize,
} from '@langgenius/dify-ui/number-field'
import type { FC, PropsWithChildren, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Input } from '@langgenius/dify-ui/input'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
} from '@langgenius/dify-ui/number-field'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { env } from '@/env'

const FormField: FC<PropsWithChildren<{ label: ReactNode }>> = (props) => {
  return (
    // Reflow on the container (a @container/chunkfields ancestor), not the
    // viewport. Below 552px the fields stack one per row, each capped at
    // max-w-[288px] so the input reads as a form field, not a full-bleed bar.
    // At/above 552px this restores flex-1 with no cap, so three columns resolve
    // to (container - gaps)/3 — pixel-identical to the stock flex-1 layout.
    <div className="max-w-[288px] space-y-2 @min-[552px]/chunkfields:max-w-none @min-[552px]/chunkfields:flex-1">
      <div className="text-xs leading-none font-semibold text-text-secondary">{props.label}</div>
      {props.children}
    </div>
  )
}

export const DelimiterInput: FC<
  Omit<InputProps, 'onChange' | 'onValueChange'> & {
    tooltip?: string
    onValueChange?: (value: string) => void
  }
> = ({ tooltip, onValueChange, value, ...rest }) => {
  const { t } = useTranslation()
  const generatedInputId = useId()
  const inputId = rest.id ?? generatedInputId
  const isComposing = useRef(false)
  const [compositionValue, setCompositionValue] = useState('')

  return (
    <FormField
      label={
        <div className="mb-1 flex items-center">
          <label htmlFor={inputId} className="mr-0.5 system-sm-semibold">
            {t(($) => $['stepTwo.separator'], { ns: 'datasetCreation' })}
          </label>
          <Infotip>
            <InfotipTrigger
              aria-label={tooltip || t(($) => $['stepTwo.separatorTip'], { ns: 'datasetCreation' })}
            />
            <InfotipContent
              aria-label={tooltip || t(($) => $['stepTwo.separatorTip'], { ns: 'datasetCreation' })}
              className="max-w-50"
            >
              {tooltip || t(($) => $['stepTwo.separatorTip'], { ns: 'datasetCreation' })}
            </InfotipContent>
          </Infotip>
        </div>
      }
    >
      <Input
        id={inputId}
        type="text"
        className="h-9"
        placeholder={t(($) => $['stepTwo.separatorPlaceholder'], { ns: 'datasetCreation' })!}
        value={isComposing.current ? compositionValue : value}
        onValueChange={(value) => {
          if (isComposing.current) setCompositionValue(value)
          else onValueChange?.(value)
        }}
        onCompositionStart={() => {
          isComposing.current = true
          setCompositionValue(String(value ?? ''))
        }}
        onCompositionEnd={(e) => {
          const committed = e.currentTarget.value
          isComposing.current = false
          setCompositionValue('')
          onValueChange?.(committed)
        }}
        {...rest}
      />
    </FormField>
  )
}

type CompoundNumberInputProps = Omit<NumberFieldProps, 'children' | 'className' | 'onValueChange'> &
  Omit<NumberFieldInputProps, 'children' | 'size' | 'onChange'> & {
    label: string
    unit?: ReactNode
    size?: NumberFieldSize
    onChange: (value: number) => void
  }

function CompoundNumberInput({
  label,
  onChange,
  unit,
  size = 'large',
  className,
  ...props
}: CompoundNumberInputProps) {
  const {
    value,
    defaultValue,
    min,
    max,
    step,
    disabled,
    readOnly,
    required,
    id,
    name,
    onBlur,
    ...inputProps
  } = props
  const emptyValue = defaultValue ?? min ?? 0

  return (
    <NumberField
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      id={id}
      name={name}
      onValueChange={(value) => onChange(value ?? emptyValue)}
    >
      <NumberFieldGroup size={size}>
        <NumberFieldInput
          {...inputProps}
          aria-label={label}
          size={size}
          // min-w-[64px] overrides the component's default min-w-0 so the input
          // can never collapse to an unusable sliver, even in an unforeseen
          // container; belt to the row's flex-wrap braces.
          className={cn('min-w-16', className)}
          onBlur={onBlur}
        />
        {Boolean(unit) && <NumberFieldUnit size={size}>{unit}</NumberFieldUnit>}
        <NumberFieldControls>
          <NumberFieldIncrement size={size} />
          <NumberFieldDecrement size={size} />
        </NumberFieldControls>
      </NumberFieldGroup>
    </NumberField>
  )
}

type LabeledCompoundNumberInputProps = Omit<CompoundNumberInputProps, 'label'>

export const MaxLengthInput: FC<LabeledCompoundNumberInputProps> = (props) => {
  const maxValue = env.NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH

  const { t } = useTranslation()
  const label = t(($) => $['stepTwo.maxLength'], { ns: 'datasetCreation' })
  return (
    <FormField label={<div className="mb-1 system-sm-semibold">{label}</div>}>
      <CompoundNumberInput
        label={label}
        size="large"
        placeholder={`≤ ${maxValue}`}
        max={maxValue}
        min={1}
        {...props}
      />
    </FormField>
  )
}

export const OverlapInput: FC<LabeledCompoundNumberInputProps> = (props) => {
  const { t } = useTranslation()
  const label = t(($) => $['stepTwo.overlap'], { ns: 'datasetCreation' })
  return (
    <FormField
      label={
        <div className="mb-1 flex items-center">
          <span className="system-sm-semibold">{label}</span>
          <Infotip>
            <InfotipTrigger
              aria-label={t(($) => $['stepTwo.overlapTip'], { ns: 'datasetCreation' })}
            />
            <InfotipContent
              aria-label={t(($) => $['stepTwo.overlapTip'], { ns: 'datasetCreation' })}
              className="max-w-50"
            >
              {t(($) => $['stepTwo.overlapTip'], { ns: 'datasetCreation' })}
            </InfotipContent>
          </Infotip>
        </div>
      }
    >
      <CompoundNumberInput
        label={label}
        size="large"
        placeholder={label || ''}
        min={1}
        {...props}
      />
    </FormField>
  )
}
