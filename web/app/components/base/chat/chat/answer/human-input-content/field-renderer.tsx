import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import {
  Select,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
  DatePickerValue,
} from '@/app/components/base/date-time-picker/date-picker'
import {
  DateTimePicker,
  DateTimePickerClear,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
  DateTimePickerValue,
} from '@/app/components/base/date-time-picker/date-time-picker'
import { parseDateValue } from '@/app/components/base/date-time-picker/date-value'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { parseFormInstant } from '@/app/components/base/markdown-blocks/date-values'
import {
  isDateFormInput,
  isDateTimeFormInput,
  isFileFormInput,
  isFileListFormInput,
  isParagraphFormInput,
  isSelectFormInput,
} from '@/app/components/workflow/nodes/human-input/types'

export type HumanInputFieldValue = string | FileEntity | FileEntity[] | null

type Props = Readonly<{
  field: FormInputItem
  label?: string
  labelId?: string
  value?: HumanInputFieldValue
  onChange: (value: HumanInputFieldValue) => void
}>

const HumanInputFieldRenderer = ({ field, label, labelId, value, onChange }: Props) => {
  const { t } = useTranslation(['common'])
  const clearLabel = t(($) => $['operation.clear'], { ns: 'common' })

  if (isParagraphFormInput(field)) {
    return (
      <Textarea
        aria-label={label ?? field.output_variable_name}
        className="h-26 sm:text-xs"
        value={typeof value === 'string' ? value : ''}
        onValueChange={(nextValue) => onChange(nextValue)}
        data-testid="content-item-textarea"
      />
    )
  }

  if (isSelectFormInput(field)) {
    const options = field.option_source.value.map((option) => ({
      name: option,
      value: option,
    }))

    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(nextValue) => {
          if (nextValue == null) return
          onChange(nextValue)
        }}
      >
        <SelectTrigger
          size="large"
          className="w-full"
          aria-label={label ?? field.output_variable_name}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner>
            <SelectPopup>
              <SelectList className="max-h-35 overflow-y-auto">
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <SelectItemText>{option.name}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    )
  }

  if (isFileFormInput(field)) {
    const singleFileValue =
      value && !Array.isArray(value) && typeof value !== 'string' ? [value] : []

    return (
      <FileUploaderInAttachmentWrapper
        value={singleFileValue}
        onChange={(files) => onChange(files[0] || null)}
        fileConfig={{
          allowed_file_types: field.allowed_file_types,
          allowed_file_extensions: field.allowed_file_extensions,
          allowed_file_upload_methods: field.allowed_file_upload_methods,
          number_limits: 1,
        }}
      />
    )
  }

  if (isFileListFormInput(field)) {
    return (
      <FileUploaderInAttachmentWrapper
        value={Array.isArray(value) ? value : []}
        onChange={(files) => onChange(files)}
        fileConfig={{
          allowed_file_types: field.allowed_file_types,
          allowed_file_extensions: field.allowed_file_extensions,
          allowed_file_upload_methods: field.allowed_file_upload_methods,
          number_limits: field.number_limits || 5,
        }}
      />
    )
  }

  if (isDateFormInput(field)) {
    const accessibleLabel = label || field.output_variable_name
    return (
      <DatePicker
        value={typeof value === 'string' ? (parseDateValue(value) ?? null) : null}
        onValueChange={(next) => onChange(next ?? '')}
      >
        {!labelId && <DatePickerLabel className="sr-only">{accessibleLabel}</DatePickerLabel>}
        <div className="flex w-full items-center gap-1">
          <DatePickerTrigger aria-labelledby={labelId} className="min-w-0 flex-1">
            <DatePickerValue className="min-w-0 flex-1 truncate" />
          </DatePickerTrigger>
          <DatePickerClear aria-label={clearLabel} />
        </div>
        <DatePickerContent aria-labelledby={labelId} />
      </DatePicker>
    )
  }

  if (isDateTimeFormInput(field)) {
    const accessibleLabel = label || field.output_variable_name
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    return (
      <DateTimePicker
        value={parseFormInstant(value) ?? null}
        timeZone={timeZone}
        onValueChange={(next) => onChange(next ? next.toISOString() : '')}
      >
        {!labelId && (
          <DateTimePickerLabel className="sr-only">{accessibleLabel}</DateTimePickerLabel>
        )}
        <div className="flex w-full items-center gap-1">
          <DateTimePickerTrigger aria-labelledby={labelId} className="min-w-0 flex-1">
            <DateTimePickerValue className="min-w-0 flex-1 truncate" />
          </DateTimePickerTrigger>
          <DateTimePickerClear aria-label={clearLabel} />
        </div>
        <DateTimePickerContent aria-labelledby={labelId} />
      </DateTimePicker>
    )
  }

  return null
}

export default React.memo(HumanInputFieldRenderer)
