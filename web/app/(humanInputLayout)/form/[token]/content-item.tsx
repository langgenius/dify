import React from 'react'
import { Markdown } from '@/app/components/base/markdown'
import Select from '@/app/components/base/select'
import Textarea from '@/app/components/base/textarea'
import Input from '@/app/components/base/input'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import type { GeneratedFormInputItem } from '@/app/components/workflow/nodes/human-input/types'

type Props = {
  content: string
  formInputFields: GeneratedFormInputItem[]
  inputs: Record<string, any>
  onInputChange: (name: string, value: any) => void
}

const ContentItem = ({ content, formInputFields, inputs, onInputChange }: Props) => {
  const isInputField = (field: string) => {
    const outputVarRegex = /{{#\$output\.[^#]+#}}/
    return outputVarRegex.test(field)
  }

  const extractFieldName = (str: string) => {
    const outputVarRegex = /{{#\$output\.([^#]+)#}}/
    const match = str.match(outputVarRegex)
    return match ? match[1] : ''
  }

  if (!isInputField(content)) {
    return (
      <Markdown content={content} />
    )
  }

  const fieldName = extractFieldName(content)
  const formInputField = formInputFields.find(field => field.output_variable_name === fieldName)

  if (!formInputField) return null

  return (
    <div className='py-3'>
      {formInputField.type === 'select' && (
        <Select
          className='w-full'
          defaultValue={inputs[fieldName]}
          onSelect={i => onInputChange(fieldName, i.value)}
          items={(formInputField.options || []).map(i => ({ name: i, value: i }))}
          allowSearch={false}
        />
      )}
      {formInputField.type === 'text-input' && (
        <Input
          type="text"
          placeholder={formInputField.placeholder}
          value={inputs[fieldName]}
          onChange={(e) => { onInputChange(fieldName, e.target.value) }}
          maxLength={formInputField.max_length || DEFAULT_VALUE_MAX_LEN}
        />
      )}
      {formInputField.type === 'paragraph' && (
        <Textarea
          className='h-[104px] sm:text-xs'
          placeholder={formInputField.placeholder}
          value={inputs[fieldName]}
          onChange={(e) => { onInputChange(fieldName, e.target.value) }}
        />
      )}
      {formInputField.type === 'number' && (
        <Input
          type="number"
          value={inputs[fieldName]}
          onChange={(e) => { onInputChange(fieldName, e.target.value) }}
        />
      )}
      {formInputField.type === 'file' && (
        <FileUploaderInAttachmentWrapper
          onChange={(files) => { onInputChange(fieldName, getProcessedFiles(files)[0]) }}
          fileConfig={{
            number_limits: 1,
            allowed_file_extensions: formInputField.allowed_file_extensions,
            allowed_file_types: formInputField.allowed_file_types,
            allowed_file_upload_methods: formInputField.allowed_file_upload_methods as any,
            // fileUploadConfig: (visionConfig as any).fileUploadConfig,
          }}
        />
      )}
      {formInputField.type === 'file-list' && (
        <FileUploaderInAttachmentWrapper
          onChange={(files) => { onInputChange(fieldName, getProcessedFiles(files)) }}
          fileConfig={{
            number_limits: formInputField.max_length,
            allowed_file_extensions: formInputField.allowed_file_extensions,
            allowed_file_types: formInputField.allowed_file_types,
            allowed_file_upload_methods: formInputField.allowed_file_upload_methods as any,
            // fileUploadConfig: (visionConfig as any).fileUploadConfig,
          }}
        />
      )}
    </div>
  )
}

export default ContentItem
