import type { NumberFieldInputProps, NumberFieldRootProps, NumberFieldSize } from '@langgenius/dify-ui/number-field'
import type { FC, PropsWithChildren, ReactNode } from 'react'
import type { InputProps } from '@/app/components/base/input'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
} from '@langgenius/dify-ui/number-field'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
import { env } from '@/env'

const TextLabel: FC<PropsWithChildren> = (props) => {
  return <label className="text-xs leading-none font-semibold text-text-secondary">{props.children}</label>
}

const FormField: FC<PropsWithChildren<{ label: ReactNode }>> = (props) => {
  return (
    <div className="flex-1 space-y-2">
      <TextLabel>{props.label}</TextLabel>
      {props.children}
    </div>
  )
}

export const DelimiterInput: FC<InputProps & { tooltip?: string }> = ({ tooltip, onChange, value, ...rest }) => {
  const { t } = useTranslation()
  const isComposing = useRef(false)
  const [compositionValue, setCompositionValue] = useState('')

  return (
    <FormField label={(
      <div className="mb-1 flex items-center">
        <span className="mr-0.5 system-sm-semibold">{t('stepTwo.separator', { ns: 'datasetCreation' })}</span>
        <Infotip aria-label={tooltip || t('stepTwo.separatorTip', { ns: 'datasetCreation' })} popupClassName="max-w-[200px]">
          {tooltip || t('stepTwo.separatorTip', { ns: 'datasetCreation' })}
        </Infotip>
      </div>
    )}
    >
      <Input
        type="text"
        className="h-9"
        placeholder={t('stepTwo.separatorPlaceholder', { ns: 'datasetCreation' })!}
        value={isComposing.current ? compositionValue : value}
        onChange={(e) => {
          if (isComposing.current)
            setCompositionValue(e.target.value)
          else
            onChange?.(e)
        }}
        onCompositionStart={() => {
          isComposing.current = true
          setCompositionValue(String(value ?? ''))
        }}
        onCompositionEnd={(e) => {
          const committed = e.currentTarget.value
          isComposing.current = false
          setCompositionValue('')
          onChange?.({ ...e, target: { ...e.target, value: committed } } as unknown as React.ChangeEvent<HTMLInputElement>)
        }}
        {...rest}
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
        <Infotip aria-label={t('stepTwo.overlapTip', { ns: 'datasetCreation' })} popupClassName="max-w-[200px]">
          {t('stepTwo.overlapTip', { ns: 'datasetCreation' })}
        </Infotip>
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
