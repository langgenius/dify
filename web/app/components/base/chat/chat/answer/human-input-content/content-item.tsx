import type { ContentItemProps } from './type'
import * as React from 'react'
import { useMemo } from 'react'
import { Markdown } from '@/app/components/base/markdown'
import Textarea from '@/app/components/base/textarea'

const ContentItem = ({
  content,
  formInputFields,
  inputs,
  onInputChange,
}: ContentItemProps) => {
  const isInputField = (field: string) => {
    const outputVarRegex = /\{\{#\$output\.[^#]+#\}\}/
    return outputVarRegex.test(field)
  }

  const extractFieldName = (str: string): string => {
    const outputVarRegex = /\{\{#\$output\.([^#]+)#\}\}/
    const match = outputVarRegex.exec(str)
    return match ? match[1] : ''
  }

  const fieldName = useMemo(() => {
    return extractFieldName(content)
  }, [content])

  const formInputField = useMemo(() => {
    return formInputFields.find(field => field.output_variable_name === fieldName)
  }, [formInputFields, fieldName])

  if (!isInputField(content)) {
    return (
      <Markdown content={content} />
    )
  }

  if (!formInputField)
    return null

  return (
    <div className="py-3">
      {formInputField.type === 'paragraph' && (
        <Textarea
          className="h-[104px] sm:text-xs"
          value={inputs[fieldName]}
          onChange={(e) => { onInputChange(fieldName, e.target.value) }}
          data-testid="content-item-textarea"
        />
      )}
    </div>
  )
}

export default React.memo(ContentItem)
