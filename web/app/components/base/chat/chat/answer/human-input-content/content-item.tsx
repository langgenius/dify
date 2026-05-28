import type { ContentItemProps } from './type'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { useMemo } from 'react'
import { Markdown } from '@/app/components/base/markdown'
<<<<<<< HEAD
import HumanInputFieldRenderer from './field-renderer'
=======
>>>>>>> upstream/main

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
    return match ? match[1]! : ''
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
<<<<<<< HEAD
      <HumanInputFieldRenderer
        field={formInputField}
        value={inputs[fieldName]}
        onChange={value => onInputChange(fieldName, value)}
      />
=======
      {formInputField.type === 'paragraph' && (
        <Textarea
          aria-label={fieldName}
          className="h-[104px] sm:text-xs"
          value={inputs[fieldName]!}
          onValueChange={(value) => { onInputChange(fieldName, value) }}
          data-testid="content-item-textarea"
        />
      )}
>>>>>>> upstream/main
    </div>
  )
}

export default React.memo(ContentItem)
