import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import * as React from 'react'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import Textarea from '@/app/components/base/textarea'
import {
  isFileFormInput,
  isFileListFormInput,
  isParagraphFormInput,
  isSelectFormInput,
} from '@/app/components/workflow/nodes/human-input/types'

export type HumanInputFieldValue = string | FileEntity | FileEntity[] | null

type Props = {
  field: FormInputItem
  value?: HumanInputFieldValue
  onChange: (value: HumanInputFieldValue) => void
}

const HumanInputFieldRenderer = ({
  field,
  value,
  onChange,
}: Props) => {
  if (isParagraphFormInput(field)) {
    return (
      <Textarea
        className="h-[104px] sm:text-xs"
        value={typeof value === 'string' ? value : ''}
        onChange={e => onChange(e.target.value)}
        data-testid="content-item-textarea"
      />
    )
  }

  if (isSelectFormInput(field)) {
    const options = field.option_source.value.map(option => ({
      name: option,
      value: option,
    }))

    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(nextValue) => {
          if (nextValue == null)
            return
          onChange(nextValue)
        }}
      >
        <SelectTrigger size="large" className="w-full" aria-label={field.output_variable_name}>
          {typeof value === 'string' ? value : ''}
        </SelectTrigger>
        <SelectContent listClassName="max-h-[140px] overflow-y-auto">
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              <SelectItemText>{option.name}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (isFileFormInput(field)) {
    const singleFileValue = value && !Array.isArray(value) && typeof value !== 'string'
      ? [value]
      : []

    return (
      <FileUploaderInAttachmentWrapper
        value={singleFileValue}
        onChange={files => onChange(files[0] || null)}
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
        onChange={files => onChange(files)}
        fileConfig={{
          allowed_file_types: field.allowed_file_types,
          allowed_file_extensions: field.allowed_file_extensions,
          allowed_file_upload_methods: field.allowed_file_upload_methods,
          number_limits: field.number_limits || 5,
        }}
      />
    )
  }

  return null
}

export default React.memo(HumanInputFieldRenderer)
