import type { FC, PropsWithChildren, ReactNode } from 'react'
import type { InputProps } from '@/app/components/base/input'
import type { NumberFieldInputProps, NumberFieldRootProps, NumberFieldSize } from '@/app/components/base/ui/number-field'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Tooltip from '@/app/components/base/tooltip'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
} from '@/app/components/base/ui/number-field'
import { env } from '@/env'

const TextLabel: FC<PropsWithChildren> = (props) => {
  return <label className="text-xs font-semibold leading-none text-text-secondary">{props.children}</label>
}

const FormField: FC<PropsWithChildren<{ label: ReactNode }>> = (props) => {
  return (
    <div className="flex-1 space-y-2">
      <TextLabel>{props.label}</TextLabel>
      {props.children}
    </div>
  )
}

export const DelimiterInput: FC<InputProps & { tooltip?: string }> = (props) => {
  const { t } = useTranslation()
  return (
    <FormField label={(
      <div className="mb-1 flex items-center">
        <span className="mr-0.5 system-sm-semibold">{t('stepTwo.separator', { ns: 'datasetCreation' })}</span>
        <Tooltip
          popupContent={(
            <div className="max-w-[200px]">
              {props.tooltip || t('stepTwo.separatorTip', { ns: 'datasetCreation' })}
            </div>
          )}
        />
      </div>
    )}
    >
      <Input
        type="text"
        className="h-9"
        placeholder={t('stepTwo.separatorPlaceholder', { ns: 'datasetCreation' })!}
        {...props}
      />
    </FormField>
  )
}

type CompoundNumberInputProps = Omit<NumberFieldRootProps, 'children' | 'className' | 'onValueChange'> & Omit<NumberFieldInputProps, 'children' | 'size' | 'onChange'> & {
  unit?: ReactNode
  size?: NumberFieldSize
  onChange: (value: number) => void
}

function CompoundNumberInput({
  onChange,
  unit,
  size = 'large',
  className,
  ...props
}: CompoundNumberInputProps) {
  const { value, defaultValue, min, max, step, disabled, readOnly, required, id, name, onBlur, ...inputProps } = props
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
      onValueChange={value => onChange(value ?? emptyValue)}
    >
      <NumberFieldGroup size={size}>
        <NumberFieldInput
          {...inputProps}
          size={size}
          className={className}
          onBlur={onBlur}
        />
        {Boolean(unit) && (
          <NumberFieldUnit size={size}>
            {unit}
          </NumberFieldUnit>
        )}
        <NumberFieldControls>
          <NumberFieldIncrement size={size} />
          <NumberFieldDecrement size={size} />
        </NumberFieldControls>
      </NumberFieldGroup>
    </NumberField>
  )
}

export const MaxLengthInput: FC<CompoundNumberInputProps> = (props) => {
  const maxValue = env.NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH

  const { t } = useTranslation()
  return (
    <FormField label={(
      <div className="mb-1 system-sm-semibold">
        {t('stepTwo.maxLength', { ns: 'datasetCreation' })}
      </div>
    )}
    >
      <CompoundNumberInput
        size="large"
        placeholder={`≤ ${maxValue}`}
        max={maxValue}
        min={1}
        {...props}
      />
    </FormField>
  )
}

export const OverlapInput: FC<CompoundNumberInputProps> = (props) => {
  const { t } = useTranslation()
  return (
    <FormField label={(
      <div className="mb-1 flex items-center">
        <span className="system-sm-semibold">{t('stepTwo.overlap', { ns: 'datasetCreation' })}</span>
        <Tooltip
          popupContent={(
            <div className="max-w-[200px]">
              {t('stepTwo.overlapTip', { ns: 'datasetCreation' })}
            </div>
          )}
        />
      </div>
    )}
    >
      <CompoundNumberInput
        size="large"
        placeholder={t('stepTwo.overlap', { ns: 'datasetCreation' }) || ''}
        min={1}
        {...props}
      />
    </FormField>
  )
}
