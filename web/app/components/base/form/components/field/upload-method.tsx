import type { LabelProps } from '../label'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldItem, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { TransferMethod } from '@/types/app'
import { useFieldContext } from '../..'

type UploadMethodFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
}

const UploadMethodField = ({ label, labelOptions, className }: UploadMethodFieldProps) => {
  const { t } = useTranslation()
  const field = useFieldContext<TransferMethod[]>()

  const { value } = field.state

  const handleUploadMethodChange = useCallback(
    (method: TransferMethod) => {
      field.handleChange(
        method === TransferMethod.all
          ? [TransferMethod.local_file, TransferMethod.remote_url]
          : [method],
      )
    },
    [field],
  )

  const selectedMethod = value.includes(TransferMethod.local_file)
    ? value.includes(TransferMethod.remote_url)
      ? TransferMethod.all
      : TransferMethod.local_file
    : value.includes(TransferMethod.remote_url)
      ? TransferMethod.remote_url
      : undefined
  const options = [
    {
      value: TransferMethod.local_file,
      label: t(($) => $['variableConfig.localUpload'], { ns: 'appDebug' }),
    },
    { value: TransferMethod.remote_url, label: 'URL' },
    { value: TransferMethod.all, label: t(($) => $['variableConfig.both'], { ns: 'appDebug' }) },
  ]

  return (
    <Field name={field.name} className={className}>
      <Fieldset
        className="flex flex-col items-stretch gap-y-0.5"
        render={
          <RadioGroup<TransferMethod>
            value={selectedMethod}
            onValueChange={handleUploadMethodChange}
          />
        }
      >
        <div className="flex h-6 items-center">
          <FieldsetLegend className={cn('mb-0 py-0', labelOptions?.className)}>
            {label}
          </FieldsetLegend>
          {!labelOptions?.isRequired && labelOptions?.showOptional && (
            <span className="ml-1 system-xs-regular text-text-tertiary">
              {t(($) => $['label.optional'], { ns: 'common' })}
            </span>
          )}
          {labelOptions?.isRequired && (
            <span className="ml-1 system-xs-regular text-text-destructive-secondary">*</span>
          )}
          {labelOptions?.tooltip && (
            <Infotip
              aria-label={labelOptions.tooltip}
              className="ml-0.5 size-4"
              popupClassName="w-[200px]"
            >
              {labelOptions.tooltip}
            </Infotip>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {options.map((option) => (
            <FieldItem key={option.value}>
              <FieldLabel className="block w-full min-w-0 py-0">
                <RadioItem<TransferMethod>
                  value={option.value}
                  className={cn(
                    'flex h-8 w-full cursor-default items-center justify-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 system-sm-regular text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:shadow-xs',
                    selectedMethod !== option.value &&
                      'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                  )}
                >
                  <span>{option.label}</span>
                </RadioItem>
              </FieldLabel>
            </FieldItem>
          ))}
        </div>
      </Fieldset>
    </Field>
  )
}

export default UploadMethodField
