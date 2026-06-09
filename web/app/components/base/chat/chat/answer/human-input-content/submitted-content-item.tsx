import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormValue } from '@/types/workflow'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import * as React from 'react'
import { FileList } from '@/app/components/base/file-uploader'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { Markdown } from '@/app/components/base/markdown'
import {
  isFileFormInput,
  isFileListFormInput,
  isParagraphFormInput,
  isSelectFormInput,
} from '@/app/components/workflow/nodes/human-input/types'

type SubmittedContentItemProps = {
  content: string
  formInputFields: FormInputItem[]
  values: Record<string, HumanInputFormValue>
}

const outputVarRegex = /\{\{#\$output\.([^#]+)#\}\}/

const isOutputField = (content: string) => outputVarRegex.test(content)

const extractFieldName = (content: string) => {
  const match = outputVarRegex.exec(content)
  return match ? match[1]! : ''
}

const SubmittedContentItem = ({
  content,
  formInputFields,
  values,
}: SubmittedContentItemProps) => {
  if (!isOutputField(content)) {
    return (
      <Markdown content={content} />
    )
  }

  const fieldName = extractFieldName(content)
  const field = formInputFields.find(field => field.output_variable_name === fieldName)
  const value = values[fieldName]

  if (!field || value == null)
    return null

  if (isParagraphFormInput(field)) {
    return (
      <span
        className="body-md-regular break-words text-text-primary"
        data-testid={`submitted-field-${fieldName}`}
      >
        {typeof value === 'string' ? value : ''}
      </span>
    )
  }

  if (isSelectFormInput(field)) {
    const selectedValue = typeof value === 'string' ? value : ''

    return (
      <div className="py-3" data-testid={`submitted-field-${fieldName}`}>
        <Select value={selectedValue} disabled>
          <SelectTrigger size="large" className="w-full" aria-label={field.output_variable_name} disabled>
            {selectedValue}
          </SelectTrigger>
          <SelectContent listClassName="max-h-[140px] overflow-y-auto">
            {field.option_source.value.map(option => (
              <SelectItem key={option} value={option}>
                <SelectItemText>{option}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (isFileFormInput(field)) {
    if (typeof value === 'string' || Array.isArray(value))
      return null

    return (
      <div className="py-3" data-testid={`submitted-field-${fieldName}`}>
        <FileList
          files={getProcessedFilesFromResponse([value])}
          showDeleteAction={false}
          showDownloadAction
        />
      </div>
    )
  }

  if (isFileListFormInput(field)) {
    if (typeof value === 'string' || !Array.isArray(value))
      return null

    return (
      <div className="py-3" data-testid={`submitted-field-${fieldName}`}>
        <FileList
          files={getProcessedFilesFromResponse(value)}
          showDeleteAction={false}
          showDownloadAction
        />
      </div>
    )
  }

  return null
}

export default React.memo(SubmittedContentItem)
