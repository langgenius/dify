import type { LabelProps } from '../label'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { useFieldContext } from '../..'
import Label from '../label'

export type Option = {
  label: string
  value: string
}

const getSelectedValue = (value: string | undefined, options: Option[]) => {
  return options.some(option => option.value === value) ? value : null
}

const getDisplayLabel = (value: string | null, options: Option[], placeholder: string) => {
  return options.find(option => option.value === value)?.label ?? placeholder
}

type SelectFieldPopupProps = {
  className?: string
  title?: string
  titleClassName?: string
}

type SelectFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  options: Option[]
  onChange?: (value: string) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  popupProps?: SelectFieldPopupProps
}

const SelectField = ({
  label,
  labelOptions,
  options,
  onChange,
  className,
  placeholder,
  disabled,
  popupProps,
}: SelectFieldProps) => {
  const { t } = useTranslation()
  const field = useFieldContext<string>()
  const placeholderText = placeholder || t('placeholder.select', { ns: 'common' })

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <Select
        items={options}
        value={getSelectedValue(field.state.value, options)}
        disabled={disabled}
        onValueChange={(next) => {
          if (next == null)
            return
          field.handleChange(next)
          onChange?.(next)
        }}
      >
        <SelectTrigger id={field.name} className="px-2">
          <SelectValue placeholder={placeholderText}>
            {(nextValue: string | null) => getDisplayLabel(nextValue, options, placeholderText)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent popupClassName={cn('w-(--anchor-width) bg-components-panel-bg-blur', popupProps?.className)}>
          {popupProps?.title && (
            <div
              className={cn(
                'flex h-[22px] items-center px-3 system-xs-medium-uppercase text-text-tertiary',
                popupProps.titleClassName,
              )}
            >
              {popupProps.title}
            </div>
          )}
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              <SelectItemText>{option.label}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export default SelectField
